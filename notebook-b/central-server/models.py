from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from pydantic import (AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StrictBool,
                      StrictInt, StringConstraints, field_validator, model_validator)

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
CameraId = Annotated[str, StringConstraints(pattern=r'^[a-z0-9][a-z0-9-]{0,63}$')]
# Current demonstration uses only these A webcam channels, never public CCTV.
DEMO_CAMERA_IDS = ('cam-01', 'cam-02', 'cam-03')


def utc(value: datetime | None = None) -> str:
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def representable_utc(value):
    try:
        return value.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        raise ValueError('Timestamp cannot be represented in UTC') from None


def interval_end(start, duration):
    try:
        return start + timedelta(seconds=duration)
    except OverflowError:
        raise ValueError('Recording interval is outside the supported datetime range') from None


UtcDatetime = Annotated[AwareDatetime, AfterValidator(representable_utc)]


class ReportInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    # Optional so an urgent report can carry only its location.
    description: str = Field(default='', max_length=4000)
    latitude: Latitude
    longitude: Longitude
    location_kind: Literal['real', 'demo'] = 'real'
    details: str = Field(default='', max_length=1000)
    occurred_at: UtcDatetime | None = None
    radius_m: float = Field(default=500, ge=1, le=5000, allow_inf_nan=False)
    # Raw phone GPS; latitude/longitude above is the (possibly corrected) report point.
    gps_latitude: Latitude | None = None
    gps_longitude: Longitude | None = None
    gps_accuracy_m: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)

    @model_validator(mode='after')
    def gps_pair(self):
        if (self.gps_latitude is None) != (self.gps_longitude is None):
            raise ValueError('gps_latitude and gps_longitude must be given together')
        return self


Username = Annotated[str, StringConstraints(pattern=r'^[a-z0-9]{4,20}$')]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]


class CredentialsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: Username
    password: Password


class PasswordResetInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    password: Password


class LocationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    latitude: Latitude
    longitude: Longitude
    kind: Literal['real', 'demo']
    approved: StrictBool
    zone: str | None = Field(default=None, max_length=100)


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
    start: UtcDatetime
    duration: float = Field(gt=0, allow_inf_nan=False)

    @model_validator(mode='after')
    def valid_interval(self):
        interval_end(self.start, self.duration)
        return self


class RecordingList(BaseModel):
    camera_id: CameraId
    ranges: list[RecordingRange]


class AgentHealth(BaseModel):
    disk_free_gb: float = Field(ge=0, allow_inf_nan=False)
    disk_low: StrictBool
    cameras: list[CameraSnapshot]


class PreserveInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    camera_id: CameraId
    start: UtcDatetime
    duration: float = Field(gt=0, le=3600, allow_inf_nan=False)

    @model_validator(mode='after')
    def valid_interval(self):
        interval_end(self.start, self.duration)
        return self


class ExportMetadata(BaseModel):
    export_id: str = Field(pattern=r'^[0-9a-f]{32}$')
    camera_id: CameraId
    start: UtcDatetime
    requested_duration: float = Field(gt=0, le=3600, allow_inf_nan=False)
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    bytes: StrictInt = Field(gt=0, le=2 * 1024 ** 3)
    download_path: str
    created: UtcDatetime


class AnalyzeInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['selective', 'all', 'benchmark'] = 'selective'
    source: Literal['recording', 'live'] = 'live'
    duration: float = Field(default=10, ge=2, le=60, allow_inf_nan=False)
    sample_fps: float = Field(default=1, gt=0, le=5, allow_inf_nan=False)
    focus_fps: float = Field(default=3, gt=0, le=10, allow_inf_nan=False)
    top_k: StrictInt = Field(default=1, ge=1, le=3)
    # Widen the search by 100 m this many times when no webcam is inside the report radius.
    expand_steps: StrictInt = Field(default=2, ge=0, le=5)


class RadiusInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    radius_m: float = Field(ge=1, le=5000, allow_inf_nan=False)


class ResponseLogInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    kind: Literal['step', 'note', 'alert_ack']
    step: StrictInt | None = Field(default=None, ge=0, le=50)
    text: str = Field(default='', max_length=500)

    @model_validator(mode='after')
    def required(self):
        if self.kind == 'step' and self.step is None:
            raise ValueError('step is required for a response step log')
        if self.kind == 'note' and not self.text:
            raise ValueError('text is required for a note')
        return self


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    note: str = Field(default='', max_length=2000)


class StreamInfo(BaseModel):
    camera_id: CameraId
    url: str = Field(pattern=r'^rtsp://[0-9a-zA-Z.\-]+(:[0-9]{1,5})?/[a-z0-9][a-z0-9-]{0,63}$')
    transport: Literal['tcp']
