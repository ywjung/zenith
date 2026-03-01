import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import engine, Base
from .routers import auth, tickets, ratings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.ENVIRONMENT == "development":
        logger.info("Development mode: auto-creating tables")
        Base.metadata.create_all(bind=engine)
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="ITSM Portal API",
    version="1.0.0",
    description="GitLab CE 기반 ITSM 포털 API",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    logger.info("%s %s %d %.1fms", request.method, request.url.path, response.status_code, elapsed)
    return response


app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(ratings.router)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}
