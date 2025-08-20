import anyio
import fastapi
import fastapi.middleware.cors

app = fastapi.FastAPI()

# Host the frontend
@app.get("/")
async def index_endpoint():
    return fastapi.responses.FileResponse("index.html")

# Set up a simple chat application over WebSockets
sessions: set[fastapi.WebSocket] = set()

@app.websocket("/ws")
async def ws_endpoint(ws: fastapi.WebSocket):
    await ws.accept()
    try:
        sessions.add(ws)
        while True:
            msg = await ws.receive_text()
            # Using a task group to maybe ensure same message ordering?
            async with anyio.create_task_group() as tg:
                for peer in sessions:
                    tg.start_soon(peer.send_text, msg)
    except fastapi.WebSocketDisconnect as e:
        pass
    finally:
        sessions.discard(ws)

# A frontend should be able to connect to any backend
app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
