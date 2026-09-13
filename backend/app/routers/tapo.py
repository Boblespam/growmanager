"""Routes de configuration et de gestion des capteurs Tapo locaux."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.all_models import GoveeDevice, TapoConfig
from app.schemas.capteur import (
    GoveeDeviceRead,
    PollResult,
    TapoConfigRead,
    TapoConfigUpdate,
    TapoDeviceCreate,
    TapoDeviceUpdate,
    TapoDiscoveryDevice,
    TapoTestResult,
)
from app.routers.capteurs import _enrich_device
from app.services.tapo_service import (
    TAPO_MODELS,
    TAPO_SOURCE,
    TapoError,
    discover_children,
    encrypt_password,
    get_or_create_config,
    poll_tapo_devices,
    test_connection,
)

router = APIRouter(prefix="/api/tapo", tags=["tapo"])


def _read_config(config: TapoConfig) -> TapoConfigRead:
    return TapoConfigRead(
        enabled=bool(config.enabled),
        hub_ip=config.hub_ip,
        username=config.username,
        credentials_set=bool(config.username and config.password_encrypted),
        last_status=config.last_status,
        last_error=config.last_error,
        last_poll_at=config.last_poll_at.replace(tzinfo=timezone.utc)
        if config.last_poll_at and config.last_poll_at.tzinfo is None
        else config.last_poll_at,
    )


@router.get("/config", response_model=TapoConfigRead)
def get_tapo_config(db: Session = Depends(get_db)):
    config = db.query(TapoConfig).order_by(TapoConfig.id_config.asc()).first()
    return _read_config(config or TapoConfig(enabled=False))


@router.put("/config", response_model=TapoConfigRead)
def update_tapo_config(payload: TapoConfigUpdate, db: Session = Depends(get_db)):
    config = get_or_create_config(db)
    if payload.enabled is not None:
        config.enabled = payload.enabled
    if payload.hub_ip is not None:
        config.hub_ip = payload.hub_ip.strip() or None
    if payload.username is not None:
        config.username = payload.username.strip() or None
    if payload.password is not None:
        config.password_encrypted = encrypt_password(payload.password) if payload.password else None
    config.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(config)
    return _read_config(config)


@router.post("/test-connection", response_model=TapoTestResult)
def tapo_test_connection(db: Session = Depends(get_db)):
    config = get_or_create_config(db)
    connected, message, child_count = asyncio.run(test_connection(config))
    config.last_status = "online" if connected else "offline"
    config.last_error = None if connected else message
    db.commit()
    return TapoTestResult(
        connected=connected,
        message=message,
        child_count=child_count,
    )


@router.get("/discover", response_model=List[TapoDiscoveryDevice])
def discover_tapo_devices(db: Session = Depends(get_db)):
    config = get_or_create_config(db)
    try:
        children = asyncio.run(discover_children(config))
    except TapoError as exc:
        config.last_status = "offline"
        config.last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    config.last_status = "online"
    config.last_error = None
    db.commit()
    existing_ids = {
        device.device_id
        for device in db.query(GoveeDevice).filter(GoveeDevice.source == TAPO_SOURCE).all()
        if device.device_id
    }
    return [
        TapoDiscoveryDevice(
            device_id=child["device_id"],
            modele=child["model"],
            device_name=child["device_name"],
            temperature=child["temperature"],
            humidite=child["humidity"],
            already_registered=child["device_id"] in existing_ids,
        )
        for child in children
    ]


@router.get("/devices", response_model=List[GoveeDeviceRead])
def list_tapo_devices(db: Session = Depends(get_db)):
    devices = db.query(GoveeDevice).filter(
        GoveeDevice.source == TAPO_SOURCE,
    ).order_by(GoveeDevice.nom).all()
    return [_enrich_device(device, db) for device in devices]


@router.post("/devices", response_model=GoveeDeviceRead, status_code=201)
def create_tapo_device(payload: TapoDeviceCreate, db: Session = Depends(get_db)):
    if payload.modele not in TAPO_MODELS:
        raise HTTPException(status_code=422, detail="Modèle Tapo attendu : T310 ou T315")
    existing = db.query(GoveeDevice).filter(
        GoveeDevice.source == TAPO_SOURCE,
        GoveeDevice.device_id == payload.device_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ce capteur Tapo est déjà enregistré")

    device = GoveeDevice(
        nom=payload.nom,
        device_id=payload.device_id,
        modele=payload.modele,
        source=TAPO_SOURCE,
        id_espace=payload.id_espace,
        actif=payload.actif,
        notes=payload.notes,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return _enrich_device(device, db)


@router.put("/devices/{device_id}", response_model=GoveeDeviceRead)
def update_tapo_device(
    device_id: int,
    payload: TapoDeviceUpdate,
    db: Session = Depends(get_db),
):
    device = db.query(GoveeDevice).filter(
        GoveeDevice.id_device == device_id,
        GoveeDevice.source == TAPO_SOURCE,
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Capteur Tapo introuvable")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(device, field, value)
    db.commit()
    db.refresh(device)
    return _enrich_device(device, db)


@router.delete("/devices/{device_id}", status_code=204)
def delete_tapo_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(GoveeDevice).filter(
        GoveeDevice.id_device == device_id,
        GoveeDevice.source == TAPO_SOURCE,
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Capteur Tapo introuvable")
    db.delete(device)
    db.commit()


@router.post("/poll", response_model=List[PollResult])
def manual_tapo_poll(db: Session = Depends(get_db)):
    try:
        return poll_tapo_devices(db)
    except TapoError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
