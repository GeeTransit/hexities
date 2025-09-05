import copy
import json
import random

import anyio
import fastapi
import fastapi.middleware.cors

app = fastapi.FastAPI()

# Host the frontend
@app.get("/")
async def index_endpoint():
    return fastapi.responses.FileResponse("index.html")

# Set up a simple chat application over WebSockets
sessions: dict[str, fastapi.WebSocket] = {}

def make_catan_game():
    return {
        "user_order": ["alice", "bob", "carol", "dave"],
        "current_user": "alice",
        "current_stage": "roll",
        # settlements: {username: [[x,y],...], ...}, same with cities, roads
        # robber: [x,y],
    }

def check_valid_event(event, state, internal=False):  # return clean event
    # if event needs randomized outcome, include random outcome
    if internal and event["type"] == "init":
        assert not state
        return {
            "type": "init",
            # "tiles": [{"y":y,"x":x,"resource":"lumber/desert","number":n/null}]
            # "ports": [{"y":y,"x":x,"type":"lumber/any"}]
        }
    if event["type"] == "end_turn":
        assert event["username"] == state["current_user"]
        assert state["current_stage"] == "normal"
        return {"type": "end_turn", "username": state["current_user"]}
    if event["type"] == "roll":
        assert event["username"] == state["current_user"]
        assert state["current_stage"] == "roll"
        return {
            "type": "roll",
            "username": state["current_user"],
            "dice_outcome": {
                "first": random.randint(1, 6),
                "second": random.randint(1, 6),
            },
        }
    assert False, "unknown event"
def apply_event(event, state):  # return new state
    # check player correct for player specific events
    # check move is correct
    # update game state and recalculate stuff if necessary (ie longest road)
    new_state = copy.deepcopy(state)
    if event["type"] == "init":
        return make_catan_game()
        # {
            # "board": {
                # y: {
                    # x: {},
                # },
                # ...
            # },
        # }
    if event["type"] == "end_turn":
        user_order = state["user_order"]
        i = user_order.index(state["current_user"])
        new_state["current_user"] = user_order[(i + 1) % len(user_order)]
        new_state["current_stage"] = "roll"
        return new_state
    if event["type"] == "roll":
        # distribute cards
        new_state["current_stage"] = "normal"
        return new_state
    assert False, "unknown event"
    # if event["type"] == "place_settlement":
        # x, y = event["x"], event["y"]
        # new_state.setdefault(x, {}).setdefault(y, {})["settlement"] = 1
def make_personalized_events(username, event):
    # useful for events which have private info like which dev card got drawn
    return [event]

def check_valid_and_apply_event(event, state, internal=False):
    event = check_valid_event(event, state, internal=internal)
    state = apply_event(event, state)
    return {**event, "state": state}

# extenal storage (store game state)
# get event, check valid, apply event, broadcast event/game state
# for now theres only one game (stored in a local file)
# and player names hardcoded
events = [check_valid_and_apply_event({"type": "init"}, {}, internal=True)]  # list of {"type": event_type, ..., "state": ...}
events_updated = anyio.Condition()

async def send(ws, event):
    await ws.send_text(json.dumps(event, separators=",:"))

class HandlerError(ValueError):
    def __init__(self, event):
        self.event = event

async def handle_event(event, session, tg, ws):
    if session.setdefault("state", "login") == "login":
        if event["type"] == "login":
            if "username" not in event:
                raise HandlerError({"type": "login_deny", "reason": "username missing"})
            username = event["username"]
            if username in sessions:
                raise HandlerError({"type": "login_deny", "reason": "given username in use"})
            i = 0
            state = None
            while i < len(events):
                for personalized_event in make_personalized_events(username, events[i]):
                    personalized_event = personalized_event.copy()
                    state = personalized_event.pop("state", state)
                    await send(ws, personalized_event)
                i += 1
            event_index = i
            assert state is not None, "should have state"
            await send(ws, {"type": "game_state", "state": state})
            await send(ws, {"type": "login_accept", "username": username})
            print("yay:", username)
            session["state"] = "game"
            session["username"] = username
            session["outgoing_obj"] = outgoing_obj = object()
            sessions[username] = session
            async def _handle_outgoing_events(i, outgoing_obj):
                while True:
                    while i >= len(events):
                        async with events_updated:
                            await events_updated.wait()
                        if session.get("outgoing_obj") is not outgoing_obj:
                            return
                    for personalized_event in make_personalized_events(username, events[i]):
                        await send(ws, personalized_event)
                    i += 1
            tg.start_soon(_handle_outgoing_events, event_index, outgoing_obj)
            return
    if session["state"] == "game":
        if event["type"] == "logout":
            del sessions[session["username"]]
            session.clear()
            await send(ws, {"type": "logout_accept"})
            return
        if event.setdefault("username", session["username"]) != session["username"]:
            raise RuntimeError("username must match own username")
        new_event = check_valid_and_apply_event(event, events[-1]["state"])
        events.append(new_event)
        async with events_updated:
            events_updated.notify_all()
        return
    raise HandlerError({"type": "debug", "reason": "unknown event"})

@app.websocket("/ws")
async def ws_endpoint(ws: fastapi.WebSocket):
    await ws.accept()
    session = {}
    try:
        async with anyio.create_task_group() as tg:
            @tg.start_soon
            async def _handle_incoming_events():
                while True:
                    try:
                        msg = await ws.receive_text()
                    except fastapi.WebSocketDisconnect as e:
                        tg.cancel_scope.cancel()
                        return
                    try:
                        event = json.loads(msg)
                        await handle_event(event, session=session, tg=tg, ws=ws)
                    except HandlerError as e:
                        print(ascii([e, msg]))
                        await send(ws, e.event)
                        continue
                    except Exception as e:
                        print(ascii([msg]))
                        import traceback; traceback.print_exc()
                        await send(ws, {"type": "debug", "reason": "invalid event", "_pyerror": repr(e)})
                        continue
    finally:
        username = session.get("username")
        if sessions.get(username) is session:
            del sessions[username]
            session.clear()
        try:
            await ws.close()
        except RuntimeError:  # happens if the websocket is already closed
            pass

# A frontend should be able to connect to any backend
app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
