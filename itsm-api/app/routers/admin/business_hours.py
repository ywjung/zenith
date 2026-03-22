"""Admin business hours and holiday endpoints."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ...audit import write_audit_log
from ...database import get_db
from ...models import BusinessHoursConfig, BusinessHoliday
from ...rbac import require_admin

business_hours_router = APIRouter()


class BusinessHoursItem(BaseModel):
    day_of_week: int          # 0=월 … 6=일
    start_time: str           # "HH:MM"
    end_time: str             # "HH:MM"
    is_active: bool = True

    @field_validator("end_time")
    @classmethod
    def end_after_start(cls, v: str, info) -> str:
        start = (info.data or {}).get("start_time")
        if start is not None and v <= start:
            raise ValueError("end_time은 start_time 이후여야 합니다")
        return v


class BusinessHoursPayload(BaseModel):
    schedule: list[BusinessHoursItem]


class HolidayCreate(BaseModel):
    date: str   # "YYYY-MM-DD"
    name: str = ""


class HolidayBulkItem(BaseModel):
    date: str   # "YYYY-MM-DD"
    name: str = ""


class HolidayBulkCreate(BaseModel):
    holidays: list[HolidayBulkItem]


@business_hours_router.get("/business-hours")
def get_business_hours(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """업무시간 설정과 공휴일 목록 반환."""
    schedule = [
        {
            "id": s.id,
            "day_of_week": s.day_of_week,
            "start_time": s.start_time.strftime("%H:%M"),
            "end_time": s.end_time.strftime("%H:%M"),
            "is_active": s.is_active,
        }
        for s in db.query(BusinessHoursConfig).order_by(BusinessHoursConfig.day_of_week).all()
    ]
    holidays = [
        {"id": h.id, "date": h.date.isoformat(), "name": h.name or ""}
        for h in db.query(BusinessHoliday).order_by(BusinessHoliday.date).all()
    ]
    from ...models import HolidayYear
    pinned_years = [
        row.year for row in db.query(HolidayYear).order_by(HolidayYear.year).all()
    ]
    return {"schedule": schedule, "holidays": holidays, "pinned_years": pinned_years}


@business_hours_router.put("/business-hours")
def put_business_hours(
    request: Request,
    data: BusinessHoursPayload,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """업무시간 스케줄 전체 교체 (기존 설정 삭제 후 재등록)."""
    from datetime import time as _time
    db.query(BusinessHoursConfig).delete()
    for item in data.schedule:
        try:
            s_h, s_m = map(int, item.start_time.split(":"))
            e_h, e_m = map(int, item.end_time.split(":"))
            if not (0 <= s_h <= 23 and 0 <= s_m <= 59 and 0 <= e_h <= 23 and 0 <= e_m <= 59):
                raise ValueError("out of range")
            start_t = _time(s_h, s_m)
            end_t = _time(e_h, e_m)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"시간 형식 오류: {item.start_time}")
        db.add(BusinessHoursConfig(
            day_of_week=item.day_of_week,
            start_time=start_t,
            end_time=end_t,
            is_active=item.is_active,
        ))
    db.commit()
    write_audit_log(db, user, "business_hours.update", "system", "business_hours", request=request)
    return {"ok": True}


@business_hours_router.post("/holidays", status_code=201)
def add_holiday(
    request: Request,
    data: HolidayCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from datetime import date as _date
    try:
        d = _date.fromisoformat(data.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식 오류 (YYYY-MM-DD)")
    existing = db.query(BusinessHoliday).filter(BusinessHoliday.date == d).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 등록된 날짜입니다.")
    h = BusinessHoliday(date=d, name=data.name or None)
    db.add(h); db.commit(); db.refresh(h)
    write_audit_log(db, user, "holiday.add", "system", str(h.id), request=request)
    return {"id": h.id, "date": h.date.isoformat(), "name": h.name or ""}


@business_hours_router.delete("/holidays/{holiday_id}", status_code=204)
def delete_holiday(
    request: Request,
    holiday_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    h = db.query(BusinessHoliday).filter(BusinessHoliday.id == holiday_id).with_for_update().first()
    if not h:
        raise HTTPException(status_code=404, detail="공휴일을 찾을 수 없습니다.")
    db.delete(h); db.commit()
    write_audit_log(db, user, "holiday.delete", "system", str(holiday_id), request=request)


@business_hours_router.post("/holiday-years/{year}", status_code=201)
def add_holiday_year(
    request: Request,
    year: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """공휴일 관리 탭에 연도 고정."""
    from ...models import HolidayYear
    if not (2000 <= year <= 2100):
        raise HTTPException(status_code=422, detail="연도는 2000~2100 사이여야 합니다.")
    if db.query(HolidayYear).filter_by(year=year).first():
        return {"year": year}
    db.add(HolidayYear(year=year))
    db.commit()
    return {"year": year}


@business_hours_router.delete("/holiday-years/{year}", status_code=204)
def delete_holiday_year(
    request: Request,
    year: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """공휴일 관리 탭에서 연도 제거 (공휴일이 있으면 거부)."""
    from ...models import HolidayYear
    from datetime import date as _date
    has_holidays = db.query(BusinessHoliday).filter(
        BusinessHoliday.date >= _date(year, 1, 1),
        BusinessHoliday.date <= _date(year, 12, 31),
    ).first()
    if has_holidays:
        raise HTTPException(status_code=409, detail="해당 연도에 공휴일이 있어 삭제할 수 없습니다.")
    row = db.query(HolidayYear).filter_by(year=year).first()
    if row:
        db.delete(row)
        db.commit()


@business_hours_router.post("/holidays/bulk", status_code=201)
def bulk_add_holidays(
    request: Request,
    data: HolidayBulkCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """여러 공휴일을 한 번에 등록합니다. 이미 등록된 날짜는 건너뜁니다."""
    from datetime import date as _date
    added = []
    skipped = []
    for item in data.holidays:
        try:
            d = _date.fromisoformat(item.date)
        except ValueError:
            continue
        existing = db.query(BusinessHoliday).filter(BusinessHoliday.date == d).first()
        if existing:
            skipped.append(item.date)
            continue
        h = BusinessHoliday(date=d, name=item.name or None)
        db.add(h)
        db.flush()
        added.append({"id": h.id, "date": h.date.isoformat(), "name": h.name or ""})
    db.commit()
    write_audit_log(db, user, "holiday.bulk_add", "system", f"added={len(added)}", request=request)
    return {"added": added, "skipped": skipped}
