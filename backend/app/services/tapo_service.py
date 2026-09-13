"""Accès local aux capteurs Tapo T310/T315 via un hub H100.

La bibliothèque ``tapo`` parle directement au H100 à son adresse LAN.
Aucun endpoint cloud Tapo n'est utilisé par ce module.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.all_models import Culture, GoveeDevice, TapoConfig, TemperatureLog
from app.services.govee_poller import compute_vpd, _get_leaf_offset

logger = logging.getLogger("tapo_service")

TAPO_SOURCE = "tapo"
TAPO_MODELS = {"T310", "T315"}
TAPO_POLL_LOCK = "growmanager_tapo_poll"


class TapoError(Exception):
    """Erreur normalisée de configuration, bibliothèque ou communication Tapo."""


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest())
    return Fernet(key)


def encrypt_password(password: str) -> str:
    return _fernet().encrypt(password.encode("utf-8")).decode("ascii")


def decrypt_password(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError) as exc:
        raise TapoError("Mot de passe Tapo illisible — vérifier SECRET_KEY") from exc


def get_or_create_config(db: Session) -> TapoConfig:
    config = db.query(TapoConfig).order_by(TapoConfig.id_config.asc()).first()
    if config is None:
        config = TapoConfig(enabled=False)
        db.add(config)
        db.flush()
    return config


def _require_config_values(config: TapoConfig) -> tuple[str, str, str]:
    if not config.hub_ip or not config.username or not config.password_encrypted:
        raise TapoError("Configuration Tapo incomplète : IP H100, identifiant et mot de passe requis")
    return config.hub_ip.strip(), config.username.strip(), decrypt_password(config.password_encrypted)


def _normalise_temperature(value: Any, unit: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        temperature = float(value)
    except (TypeError, ValueError):
        return None
    unit_text = str(unit or "").strip().lower()
    if unit_text in {"f", "°f", "fahrenheit", "1"} or "fahrenheit" in unit_text:
        temperature = (temperature - 32.0) * 5.0 / 9.0
    return round(temperature, 1)


def _child_to_reading(child: Any) -> Optional[dict[str, Any]]:
    model = str(getattr(child, "model", "") or "").upper()
    if model not in TAPO_MODELS:
        return None

    device_id = getattr(child, "device_id", None)
    if not device_id:
        return None

    temperature = _normalise_temperature(
        getattr(child, "current_temperature", None),
        getattr(child, "temperature_unit", None),
    )
    humidity_raw = getattr(child, "current_humidity", None)
    try:
        humidity = round(float(humidity_raw), 1) if humidity_raw is not None else None
    except (TypeError, ValueError):
        humidity = None

    return {
        "device_id": str(device_id),
        "model": model,
        "device_name": str(getattr(child, "nickname", None) or device_id),
        "temperature": temperature,
        "humidity": humidity,
    }


async def _load_tapo_children(hub_ip: str, username: str, password: str) -> list[dict[str, Any]]:
    try:
        from tapo import ApiClient
    except ImportError as exc:
        raise TapoError("La bibliothèque tapo n'est pas installée dans le backend") from exc

    try:
        client = ApiClient(username, password)
        hub = await client.h100(hub_ip)
        children = await hub.get_child_device_list()
    except Exception as exc:
        raise TapoError(f"Connexion locale au H100 impossible : {exc}") from exc

    readings = []
    for child in children:
        reading = _child_to_reading(child)
        if reading is not None:
            readings.append(reading)
    return readings


async def discover_children(config: TapoConfig) -> list[dict[str, Any]]:
    hub_ip, username, password = _require_config_values(config)
    return await _load_tapo_children(hub_ip, username, password)


async def test_connection(config: TapoConfig) -> tuple[bool, str, int]:
    try:
        children = await discover_children(config)
        return True, f"H100 joignable — {len(children)} capteur(s) T310/T315 trouvé(s)", len(children)
    except TapoError as exc:
        return False, str(exc), 0


def _active_culture_id(db: Session, id_espace: Optional[int]) -> Optional[int]:
    if not id_espace:
        return None
    culture = db.query(Culture).filter(
        Culture.id_espace == id_espace,
        Culture.statut == "active",
    ).first()
    return culture.id_culture if culture else None


def _acquire_poll_lock(db: Session) -> tuple[bool, bool]:
    """Prend un verrou MySQL pour éviter deux jobs Tapo avec deux workers.

    Le second booléen indique si le moteur supporte le verrou nommé. Les tests
    sur un moteur non-MySQL continuent sans verrou applicatif.
    """
    try:
        acquired = db.execute(
            text("SELECT GET_LOCK(:lock_name, 0)"),
            {"lock_name": TAPO_POLL_LOCK},
        ).scalar()
        return bool(acquired), True
    except Exception:
        return True, False


def _release_poll_lock(db: Session) -> None:
    try:
        db.execute(text("SELECT RELEASE_LOCK(:lock_name)"), {"lock_name": TAPO_POLL_LOCK})
    except Exception:
        pass


def poll_tapo_devices(db: Session) -> list[dict[str, Any]]:
    """Lit les enfants T310/T315 et crée les TemperatureLog correspondants."""
    config = get_or_create_config(db)
    devices = db.query(GoveeDevice).filter(
        GoveeDevice.source == TAPO_SOURCE,
        GoveeDevice.actif.is_(True),
    ).all()
    if not config.enabled or not devices:
        return []

    acquired, uses_named_lock = _acquire_poll_lock(db)
    if not acquired:
        db.rollback()
        return []

    now = datetime.now(timezone.utc)
    try:
        try:
            readings = asyncio.run(discover_children(config))
            config.last_status = "online"
            config.last_error = None
        except TapoError as exc:
            config.last_status = "offline"
            config.last_error = str(exc)
            config.last_poll_at = now
            db.commit()
            return [
                {
                    "device_id": device.id_device,
                    "nom": device.nom,
                    "source": TAPO_SOURCE,
                    "success": False,
                    "erreur": str(exc),
                }
                for device in devices
            ]

        by_id = {reading["device_id"]: reading for reading in readings}
        leaf_offset = _get_leaf_offset(db)
        results = []

        for device in devices:
            reading = by_id.get(device.device_id or "")
            if not reading or reading["temperature"] is None or reading["humidity"] is None:
                results.append({
                    "device_id": device.id_device,
                    "nom": device.nom,
                    "source": TAPO_SOURCE,
                    "success": False,
                    "erreur": "Capteur absent ou mesure température/humidité indisponible",
                })
                continue

            temperature = reading["temperature"]
            humidity = reading["humidity"]
            vpd = compute_vpd(temperature, humidity, leaf_offset=leaf_offset)
            db.add(TemperatureLog(
                id_device=device.id_device,
                id_culture=_active_culture_id(db, device.id_espace),
                id_espace=device.id_espace,
                date_heure=now,
                temperature=temperature,
                humidite=humidity,
                vpd=vpd,
                source=TAPO_SOURCE,
            ))
            results.append({
                "device_id": device.id_device,
                "nom": device.nom,
                "source": TAPO_SOURCE,
                "success": True,
                "temperature": temperature,
                "humidite": humidity,
                "vpd": vpd,
            })

        config.last_status = "online"
        config.last_error = None
        config.last_poll_at = now
        db.commit()
        return results
    except Exception:
        db.rollback()
        raise
    finally:
        if uses_named_lock:
            _release_poll_lock(db)
