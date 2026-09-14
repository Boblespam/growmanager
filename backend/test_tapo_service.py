"""Tests unitaires sans matériel pour le transport local Tapo."""
import asyncio
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models.all_models import Culture, EspaceCulture, GoveeDevice, TapoConfig, TemperatureLog
from app.services.tapo_service import (
    TapoError,
    _child_to_reading,
    _load_tapo_children,
    decrypt_password,
    encrypt_password,
    poll_tapo_devices,
)


class FakeChild:
    model = "T310"
    device_id = "child-310"
    nickname = "Tente croissance"
    current_temperature = 24.3
    current_humidity = 61.0
    temperature_unit = "celsius"


class TapoServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_normalises_t31x_reading(self):
        self.assertEqual(
            _child_to_reading(FakeChild()),
            {
                "device_id": "child-310",
                "model": "T310",
                "device_name": "Tente croissance",
                "temperature": 24.3,
                "humidity": 61.0,
            },
        )

    def test_ignores_non_sensor_child(self):
        child = FakeChild()
        child.model = "S200B"
        self.assertIsNone(_child_to_reading(child))

    def test_password_round_trip(self):
        password = "secret-tapo"
        self.assertEqual(decrypt_password(encrypt_password(password)), password)

    def test_h100_children_are_read_locally(self):
        class FakeHub:
            async def get_child_device_list(self):
                return [FakeChild()]

        class FakeClient:
            def __init__(self, username, password):
                self.credentials = (username, password)

            async def h100(self, ip):
                self.ip = ip
                return FakeHub()

        fake_tapo = types.SimpleNamespace(ApiClient=FakeClient)
        with patch.dict(sys.modules, {"tapo": fake_tapo}):
            readings = asyncio.run(_load_tapo_children("192.168.1.100", "user", "password"))
        self.assertEqual(readings[0]["device_id"], "child-310")

    def test_h100_failure_is_reported_as_offline_error(self):
        class FailingClient:
            def __init__(self, username, password):
                pass

            async def h100(self, ip):
                raise OSError("H100 offline")

        fake_tapo = types.SimpleNamespace(ApiClient=FailingClient)
        with patch.dict(sys.modules, {"tapo": fake_tapo}):
            with self.assertRaises(TapoError):
                asyncio.run(_load_tapo_children("192.168.1.100", "user", "password"))

    def test_poll_persists_tapo_log_and_vpd(self):
        space = EspaceCulture(nom="Tente croissance")
        self.db.add(space)
        self.db.flush()
        self.db.add(Culture(id_espace=space.id_espace, statut="active"))
        self.db.add(GoveeDevice(
            nom="T315",
            device_id="child-315",
            modele="T315",
            source="tapo",
            id_espace=space.id_espace,
            actif=True,
        ))
        self.db.add(TapoConfig(
            enabled=True,
            hub_ip="192.168.1.100",
            username="user",
            password_encrypted=encrypt_password("password"),
        ))
        self.db.commit()

        fake_discovery = AsyncMock(return_value=[{
            "device_id": "child-315",
            "model": "T315",
            "device_name": "Tente croissance",
            "temperature": 25.1,
            "humidity": 58.0,
        }])
        with patch("app.services.tapo_service.discover_children", fake_discovery):
            result = poll_tapo_devices(self.db)

        self.assertTrue(result[0]["success"])
        log = self.db.query(TemperatureLog).one()
        self.assertEqual(log.source, "tapo")
        self.assertEqual(log.humidite, 58.0)
        self.assertIsNotNone(log.vpd)
        self.assertEqual(log.id_culture, 1)

    def test_poll_marks_h100_offline_without_creating_log(self):
        device = GoveeDevice(
            nom="T310", device_id="child-310", modele="T310",
            source="tapo", actif=True,
        )
        self.db.add(device)
        self.db.add(TapoConfig(
            enabled=True,
            hub_ip="192.168.1.100",
            username="user",
            password_encrypted=encrypt_password("password"),
        ))
        self.db.commit()

        fake_discovery = AsyncMock(side_effect=TapoError("H100 offline"))
        with patch("app.services.tapo_service.discover_children", fake_discovery):
            result = poll_tapo_devices(self.db)

        self.assertFalse(result[0]["success"])
        self.assertEqual(self.db.query(TemperatureLog).count(), 0)
        config = self.db.query(TapoConfig).one()
        self.assertEqual(config.last_status, "offline")


if __name__ == "__main__":
    unittest.main()
