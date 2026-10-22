from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import (AwareDatetime, BaseModel, ConfigDict, Field, StrictBool,
                      StringConstraints, field_validator)

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
CameraId = Annotated[str, StringConstraints(pattern=r'^[a-z0-9][a-z0-9-]{0,63}$')]


def utc(value: datetime | None = None) -> str:
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


class ReportInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    description: str = Field(min_length=1, max_length=4000)
    latitude: Latitude
    longitude: Longitude
    location_kind: Literal['real', 'demo'] = 'real'
    details: str = Field(default='', max_length=1000)
    occurred_at: AwareDatetime | None = None
    radius_m: float = Field(default=500, ge=1, le=5000, allow_inf_nan=False)


class LocationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    latitude: Latitude
    longitude: Longitude
    kind: Literal['real', 'demo']
    approved: StrictBool


class CameraSnapshot(BaseModel):
    # Whitelist A's metadata: never retain arbitrary upstream/device/secret fields.
    id: CameraId
    name: str = Field(min_length=1, max_length=200)
    online: StrictBool
    recording: StrictBool


class CameraList(BaseModel):
    cameras: list[CameraSnapshot] = Field(max_length=1000)

    @field_validator('cameras')
    @classmethod
    def unique_ids(cls, cameras):
        if len({camera.id for camera in cameras}) != len(cameras):
            raise ValueError('Duplicate camera IDs')
        return cameras


class RecordingRange(BaseModel):
    start: AwareDatetime
    duration: float = Field(gt=0, allow_inf_nan=False)


class RecordingList(BaseModel):
    camera_id: CameraId
    ranges: list[RecordingRange]
