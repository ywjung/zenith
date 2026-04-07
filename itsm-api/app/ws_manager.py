"""WebSocket connection manager for real-time ticket collaboration.

In-memory only (single-process). Redis pub/sub is intentionally omitted
to keep complexity low; add it later if multi-worker support is needed.
"""
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manage per-ticket WebSocket rooms.

    Room key: str(ticket_iid)
    Each connection is stored as a dict:
        {"ws": WebSocket, "user_id": int, "username": str}
    """

    def __init__(self) -> None:
        # room_id → list of connection dicts
        self.rooms: dict[str, list[dict]] = defaultdict(list)

    async def connect(
        self,
        ws: WebSocket,
        ticket_iid: str,
        user_id: int,
        username: str,
    ) -> None:
        await ws.accept()
        conn = {"ws": ws, "user_id": user_id, "username": username}
        self.rooms[ticket_iid].append(conn)
        logger.debug("WS connect: ticket=%s user=%s total=%d", ticket_iid, username, len(self.rooms[ticket_iid]))
        await self.broadcast_viewers(ticket_iid)

    async def disconnect(self, ws: WebSocket, ticket_iid: str) -> None:
        room = self.rooms[ticket_iid]
        self.rooms[ticket_iid] = [c for c in room if c["ws"] is not ws]
        if not self.rooms[ticket_iid]:
            del self.rooms[ticket_iid]
        logger.debug("WS disconnect: ticket=%s remaining=%d", ticket_iid, len(self.rooms.get(ticket_iid, [])))
        try:
            await self.broadcast_viewers(ticket_iid)
        except Exception as e:
            logger.warning("broadcast_viewers failed after disconnect (ticket=%s): %s", ticket_iid, e)

    async def broadcast_to_room(
        self,
        ticket_iid: str,
        message: dict,
        exclude_ws: WebSocket | None = None,
    ) -> None:
        """Send a JSON message to all connections in a room, optionally excluding one."""
        dead: list[WebSocket] = []
        for conn in list(self.rooms.get(ticket_iid, [])):
            if conn["ws"] is exclude_ws:
                continue
            try:
                await conn["ws"].send_json(message)
            except Exception:
                dead.append(conn["ws"])

        # Clean up dead connections silently
        for ws in dead:
            self.rooms[ticket_iid] = [c for c in self.rooms.get(ticket_iid, []) if c["ws"] is not ws]

    async def broadcast_viewers(self, ticket_iid: str) -> None:
        """Push the current viewer list to every connection in the room."""
        viewers = [
            {"id": c["user_id"], "name": c["username"]}
            for c in self.rooms.get(ticket_iid, [])
        ]
        message = {"type": "viewers", "users": viewers}
        await self.broadcast_to_room(ticket_iid, message)


manager = ConnectionManager()
