const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const v = require('valibot');
const ws = require('ws');

const server = new http.Server();
const wsserver = new ws.WebSocketServer({ server, path: '/ws' });

function kind(q, r) {
	// 0, 0 is a tile
	if (q%2 == 0 && r%2 == 0) {
		if ((q-r)%6 == 0) {
			return 'tile';
		} else {
			return 'node';
		}
	} else if ((q-r)%3 == 0) {
		return 'edge';
	}
}
const neighbours1 = [[0, 1], [0, -1], [-1, 0], [1, 0], [1, -1], [-1, 1]];
const neighbours2 = [[2, -1], [-2, 1], [-1, 2], [1, -2], [-1, -1], [1, 1]];

// TODO: load and store events to file for persistence
const events = [{ state: {} }];
const filename = 'game-js.jsonl';
const sessions = new Set();

function persist(event, state) {
	fs.appendFileSync(filename, JSON.stringify(event) + '\n', { flush: true });
	event.state = state;
	events.push(event);
	broadcast(event);
}

function broadcast(event) {
	console.log(JSON.stringify({ ...event, state: undefined }));
  for (const session of sessions) {
    try {
      // TODO: personalize events
      session.ws.send(JSON.stringify(event));
    } catch (err) {
      console.error({ err, event, session });
    }
  }
}

// TODO: implement game logic
// TODO: write tests

/*
type State = {
	user_order: string[],
	current_user: string,
	current_stage: "roll",
	nodes: {
		x: number,
		y: number,
	}[],
	edges: {
		x: number,
		y: number,
	}[],
	tiles: {
		x: number,
		y: number,
	}[],
	hands: {
		username: string,
		resources: {
			brick?: number,
			ore?: number,
			sheep?: number,
			wheat?: number,
			wood?: number,
			unknown?: number,
		},
		devcards: {
			invention?: number,
			knight?: number,
			monopoly?: number,
			road_building?: number,
			victory_point?: number,
			unknown?: number,
		},
	}[],
	devcards: {
		invention?: number,
		knight?: number,
		monopoly?: number,
		road_building?: number,
		victory_point?: number,
		unknown?: number,
	},
}
type Event = {
	type: "init",
	tiles: {
		x: number,
		y: number,
		resource: "brick" | "ore" | "sheep" | "wheat" | "wood",
		number: number,
	}[],
} | {
	type: "roll",
	username: string,
	dice_outcome: {
		first: number,
		second: number,
	},
} | {
	type: "end_turn",
	username: string,
}
const EventSchema = v.variant('type', [
	v.object({
		type: v.literal('roll'),
		username: v.optional(v.string()),
		dice_outcome: v.optional(v.object({
			first: v.number(),
			second: v.number(),
		})),
	}),
	v.object({
		type: v.literal('end_turn'),
		username: v.optional(v.string()),
	}),
]);
*/

function next(array, value) {
	const i = array.indexOf(value);
	if (i == -1) throw new Error("value not in array");
	return array[(i + 1) % array.length];
}

function prev(array, value) {
	const i = array.indexOf(value);
	if (i == -1) throw new Error("value not in array");
	return array[(i - 1 + array.length) % array.length];
}

// function ensureGenerated(obj, key, mustExist, generatorFunc) {
	// if (obj[key] == null) {
		// if (mustExist) {
			// throw new Error(`missing ${key} during internal event loading`);
		// } else {
			// obj[key] = generatorFunc();
		// }
	// }
// }

function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = (Math.random() * (i + 1)) | 0;
		[array[i], array[j]] = [array[j], array[i]];
	}
}
function choice(object) {
	const keys = []
	let total = 0;
	for (const [key, weight] of Object.entries(object)) {
		keys.push(key);
		total += weight;
	}
	assert.notEqual(total, 0);
	let i = Math.random() * total;
	for (const key of keys) {
		i -= object[key];
		if (i < 0) {
			return key;
		}
	}
	assert.fail("should never get here");
}

function find(array, constraints) {
	return array.find(obj => Object.entries(constraints).every(([key, value]) => {
		if (typeof value === "function") {
			return value(obj[key]);
		} else {
			return obj[key] === value
		}
	}));
}

function tilesWithNumber(number, state) {
	return state.tiles.filter(tile => {
		tile.resource !== "desert"
		&& tile.number == number
	});
}

function tileNeighbours(tile, state) {
	return neighbours2.flatMap(([dx, dy]) => {
		const x = tile.x + 2*dx, y = tile.y + 2*dy;
		return (kind(x, y) == "tile" && find(state.tiles, { x, y })) ?? [];
	});
}

function edgeNodes(edge, state) {
	return neighbours1.flatMap(([dx, dy]) => {
		const x = edge.x + dx, y = edge.y + dy;
		return (kind(x, y) == "node" && find(state.nodes, { x, y })) ?? [];
	});
}

function nodeNeighbours(node, state) {
	return neighbours1.flatMap(([dx, dy]) => {
		const x = node.x + 2*dx, y = node.y + 2*dy;
		return (kind(x, y) == "node" && find(state.nodes, { x, y })) ?? [];
	});
}

function nodeEdges(node, state) {
	return neighbours1.flatMap(([dx, dy]) => {
		const x = node.x + dx, y = node.y + dy;
		return (kind(x, y) == "edge" && find(state.edges, { x, y })) ?? [];
	});
}

function consumeResources(hand, state, resources) {
	for (const [resource, amount] of Object.entries(resources)) {
		v.assert(v.object({
			[resource]: v.pipe(v.number(), v.minValue(1)),
		}), hand.resources);
		hand.resources[resource] -= amount;
		state.resources[resource] += amount;
	}
}

function apply(event, state, session) {
	// can modify game state and event
	if (event.type == "init") {
		// assert(session.internal, "internal event");
		if (!session.internal) {
			const tiles = [{ x: 0, y: 0 }];
			for (let i = 1; i <= 2; i++) {
				// expand every tile
				for (const { x, y } of [...tiles]) {
					// add neighbouring nodes
					for (const [dx, dy] of neighbours2) {
						const xx = x + 2*dx, yy = y + 2*dy;
						if (!find(tiles, { x: xx, y: yy })) {
							tiles.push({ x: xx, y: yy });
						}
					}
				}
			}
			assert.equal(tiles.length, 3+4+5+4+3);
			const resources = Object.entries({
				brick: 3,
				ore: 3,
				sheep: 4,
				wheat: 4,
				wood: 4,
			}).flatMap(([resource, count]) => Array(count).fill(resource));
			assert.equal(resources.length, tiles.length - 1);
			shuffle(resources);
			const placed = {};
			const numbers = [2, 12, ...Array(2).fill([3, 4, 5, 9, 10, 11]).flat()];
			const redNumbers = Array(2).fill([6, 8]).flat();
			assert.equal(numbers.length + redNumbers.length, tiles.length - 1);
			shuffle(numbers);
			shuffle(redNumbers);
			const order = [...tiles];
			shuffle(order);
			// place desert first
			const desert = order.pop();
			desert.resource = "desert";
			desert.robber = true;
			// maybe place red pieces first
			for (const tile of order) {
				if (redNumbers.length == 0) {
					break;
				}
				if (tile.resource != null) {
					continue;
				}
				if (tileNeighbours(tile, state).some(tile => [6, 8].includes(tile.number))) {
					continue;
				}
				tile.number = redNumbers.pop();
				tile.resource = resources.pop();
			}
			// then place others
			for (const tile of order) {
				if (numbers.length == 0) {
					break;
				}
				if (tile.resource != null) {
					continue;
				}
				tile.number = numbers.pop();
				tile.resource = resources.pop();
			}
			assert.equal(numbers.length, 0);
			assert.equal(resources.length, 0);
			event.tiles = tiles;
			// "oceans": [
				// oceans
			// ]
			// "tiles": [{"x": y, "y": x, "resource": "lumber/desert", "number":n/null}]
			// "ports": [{"y":y,"x":x,"type":"lumber/any"}]
		}
		// assert.deepEqual(state, {});
		v.assert(v.object({
			type: v.literal("init"),
			tiles: v.array(v.pipe(
				v.object({
					x: v.pipe(v.number(), v.integer()),
					y: v.pipe(v.number(), v.integer()),
					resource: v.pipe(v.string(), v.values(["brick", "ore", "sheep", "wheat", "wood", "desert"])),
					number: v.pipe(v.optional(v.number()), v.values([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
					robber: v.optional(v.boolean()),
				}),
				v.check(({ x, y }) => kind(x, y) == "tile", "tile not aligned to hex grid"),
			)),
		}), event);
		/*
		v.assert(v.pipe(
			v.object({
				type: v.literal("init"),
				user_order: v.pipe(
					v.optional(v.array(v.string()), ["alice", "bob", "carol", "dave"]),
					v.check(arr => new Set(arr).size === arr.length, "usernames not unique"),
				),  // should be all unique
				current_user: v.optional(v.string()),  // should be in user_order
				current_stage: v.pipe(
					v.optional(v.string(), "roll"),
					v.values(["roll", "normal"]),
				),
				nodes: v.pipe(
					v.array(v.object({
						x: v.pipe(v.number(), v.integer()),
						y: v.pipe(v.number(), v.integer()),
						username: v.optional(v.string()),
						settlement: v.optional(v.boolean()),
					})),
					v.checkItems(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
				),
				edges: v.pipe(
					v.array(v.object({
						x: v.pipe(v.number(), v.integer()),
						y: v.pipe(v.number(), v.integer()),
						username: v.optional(v.string()),
						road: v.optional(v.boolean()),
					})),
					v.checkItems(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
				),
				tiles: v.pipe(
					v.array(v.object({
						x: v.pipe(v.number(), v.integer()),
						y: v.pipe(v.number(), v.integer()),
						resource: v.pipe(v.string(), v.values(["brick", "ore", "sheep", "wheat", "wood", "desert"])),
						number: v.pipe(v.optional(v.number()), v.values([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))),
						robber: v.optional(v.boolean()),
					}),
					v.checkItems(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
				),
				hands: v.optional(v.array(v.object({
					username: v.string(),
					resources: v.object(v.entriesFromList(
						["brick", "ore", "sheep", "wheat", "wood"],
						v.pipe(v.number(), v.integer(), v.minValue(0)),
					)),
					devcards: v.object(v.entriesFromList(
						["invention", "knight", "monopoly", "road_building", "victory_point"],
						v.pipe(v.number(), v.integer(), v.minValue(0)),
					)),
				}))),
				devcards: v.optional(v.object(v.entriesFromList(
					["invention", "knight", "monopoly", "road_building", "victory_point"],
					v.pipe(v.number(), v.integer(), v.minValue(0)),
				)),
			}),
			v.transform(event => {
				event.current_user ??= event.user_order[0];
			}),
			v.check(event => event.user_order.includes(event.current_user), "current_user not in usernames"),
		)), event);
		*/
		const usernames = ["alice", "bob", "carol", "dave"];
		state.user_order = usernames;
		state.current_user = usernames[0];
		state.current_stage = "setup";
		state.tiles = event.tiles;
		state.nodes = [];
		state.edges = [];
		const nodes = new Set();
		for (const tile of event.tiles) {
			const { x, y } = tile;
			// add neighbouring nodes
			for (const [dx, dy] of neighbours1) {
				const xx = x + 2*dx, yy = y + 2*dy;
				if (!find(state.nodes, { x: xx, y: yy })) {
					state.nodes.push({ x: xx, y: yy });
				}
			}
			// add neighbouring edges
			for (const [dx, dy] of neighbours2) {
				const xx = x + dx, yy = y + dy;
				if (!find(state.edges, { x: xx, y: yy })) {
					state.edges.push({ x: xx, y: yy });
				}
			}
		}
		state.hands = state.user_order.map(username => ({
			username,
			resources: Object.fromEntries("brick,ore,sheep,wheat,wood".split(",").map(x => [x, 0])),
			devcards: Object.fromEntries("invention,knight,monopoly,road_building,victory_point".split(",").map(x => [x, 0])),
		}));
		state.resources = {
			brick: 19,
			ore: 19,
			sheep: 19,
			wheat: 19,
			wood: 19,
		};
		state.devcards = {
			invention: 2,
			knight: 14,
			monopoly: 2,
			road_building: 2,
			victory_point: 5,
		};
	} else if (event.type == "roll") {
		if (!session.internal) {
			event.username = session.username;
			event.dice_outcome = {
				first: Math.random()*6|0 + 1,
				second: Math.random()*6|0 + 1,
			};
		}
		v.assert(v.object({
			type: v.literal("roll"),
			username: v.pipe(v.string(), v.value(state.current_user)),
			dice_outcome: v.object({
				first: v.pipe(v.number(), v.values([1, 2, 3, 4, 5, 6])),
				second: v.pipe(v.number(), v.values([1, 2, 3, 4, 5, 6])),
			}),
		}), event);
		assert.equal(state.current_stage, "roll", "expected roll stage");
		// TODO: distribute resources matching number rolled
		const total = event.dice_outcome.first + event.dice_outcome.second;
		if (total != 7) {
			state.current_stage = "normal";
			state.current_devcard_played = false;
			const production = {};
			for (const tile of tilesWithNumber(total, state)) {
				for (const node of tileNeighbours(tile, state)) {
					if (node.settlement) {
						production[tile.resource] ??= {};
						production[tile.resource][node.username] ??= 0;
						production[tile.resource][node.username] += node.city ? 2 : 1;
					}
				}
			}
			for (const [resource, distribution] of Object.entries(production)) {
				if (
					Object.entries(distribution).length <= 1
					|| Object.values(distribution).reduce((a, b) => a + b) <= state.resources[resource]
				) {
					for (const [username, amount] of Object.entries(distribution)) {
						state.resources[resource] -= amount;
						find(state.hands, { username }).resources[resource] += amount;
					}
				}
			}
		} else {
			state.current_stage = "robber";
			state.current_devcard_played = false;
		}
	} else if (event.type == "end_turn") {
		if (!session.internal) {
			event.username = session.username;
		}
		v.assert(v.object({
			type: v.literal("end_turn"),
			username: v.pipe(v.string(), v.value(state.current_user)),
		}), event);
		assert.equal(state.current_stage, "normal", "expected normal stage");
		state.current_stage = "roll";
		state.current_user = next(state.user_order, event.username);
		// TODO: reset anything related to current turn
	} else if (event.type == "build_road") {
		if (!session.internal) {
			event.username = session.username;
		}
		v.assert(v.pipe(
			v.object({
				type: v.literal("build_road"),
				username: v.pipe(v.string(), v.value(state.current_user)),
				x: v.pipe(v.number(), v.integer()),
				y: v.pipe(v.number(), v.integer()),
			}),
			v.check(({ x, y }) => kind(x, y) == "edge", "edge not aligned to hex grid"),
		), event);
		assert("normal,setup".split(",").includes(state.current_stage), "expected normal or setup stage");
		assert(
			state.edges.filter(edge => edge.road && edge.username == event.username).length < 15,
			"road limit reached",
		);
		if (state.current_stage == "setup") {
			assert.notEqual(state.setup_settlement, undefined, "setup settlement not yet placed");
		}
		// needs to be next to a previous road without an opposing settlement in between
		const edge = find(state.edges, { x: event.x, y: event.y });
		assert.equal(edge.road, undefined, "edge is occupied");
		if (state.current_stage == "normal") {
			assert(
				edgeNodes(edge, state).some(node =>
					nodeEdges(node, state).some(otherEdge =>
						edge !== otherEdge
						&& otherEdge.username == event.username
						&& (!node.settlement || node.username == event.username)
					)
				),
				"road not adjacent to own road or settlement",
			);
		}
		if (state.current_stage == "setup") {
			// road must be beside settlement without other roads
			assert(
				edgeNodes(edge, state).some(node =>
					node.username == event.username
					&& nodeEdges(node, state).every(otherEdge => !otherEdge.username)
				),
				"road not adjacent to setup settlement",
			);
		}
		const hand = find(state.hands, { username: event.username });
		if (state.current_stage == "normal") {
			consumeResources(hand, state, {
				brick: 1,
				wood: 1,
			});
		}
		edge.road = true;
		edge.username = event.username;
		if (state.current_stage == "setup") {
			state.setup_settlement = undefined;
			if (!state.setup_reverse) {
				state.current_user = next(state.user_order, state.current_user);
				if (state.current_user == state.user_order[0]) {
					state.setup_reverse = true;
				}
			}
			if (state.setup_reverse) {
				if (state.current_user == state.user_order[0]) {
					state.current_stage = "normal";
					state.setup_reverse = undefined;
				} else {
					state.current_user = prev(state.user_order, state.current_user);
				}
			}
		}
	} else if (event.type == "build_settlement") {
		if (!session.internal) {
			event.username = session.username;
		}
		v.assert(v.pipe(
			v.object({
				type: v.literal("build_settlement"),
				username: v.pipe(v.string(), v.value(state.current_user)),
				x: v.pipe(v.number(), v.integer()),
				y: v.pipe(v.number(), v.integer()),
			}),
			v.check(({ x, y }) => kind(x, y) == "node", "node not aligned to hex grid"),
		), event);
		assert("normal,setup".split(",").includes(state.current_stage), "expected normal or setup stage");
		assert(
			state.nodes.filter(node => node.settlement && node.username == event.username && !node.city).length < 5,
			"settlement limit reached",
		);
		if (state.current_stage == "setup") {
			assert.equal(state.setup_settlement, undefined, "setup settlement already placed");
		}
		const node = find(state.nodes, { x: event.x, y: event.y });
		assert.equal(node.settlement, undefined, "node is occupied");
		assert(
			nodeNeighbours(node, state).every(otherNode =>
				node === otherNode
				|| !otherNode.settlement
			),
			"settlement too close to other settlements",
		);
		if (state.current_stage == "normal") {
			assert(
				nodeEdges(node, state).some(edge => edge.username == event.username),
				"settlement not adjacent to own road",
			);
		}
		const hand = find(state.hands, { username: event.username });
		if (state.current_stage == "normal") {
			consumeResources(hand, state, {
				brick: 1,
				sheep: 1,
				wheat: 1,
				wood: 1,
			});
		}
		node.settlement = true;
		node.username = event.username;
		if (state.current_stage == "setup") {
			state.setup_settlement = true;
		}
	} else if (event.type == "build_devcard") {
		if (!session.internal) {
			event.username = session.username;
			event.devcard = choice(state.devcards);
		}
		v.assert(v.object({
			type: v.literal("build_devcard"),
			username: v.pipe(v.string(), v.value(state.current_user)),
			devcard: v.pipe(v.string(), v.picklist("invention,knight,monopoly,road_building,victory_point".split(","))),
		}), event);
		assert.equal(state.current_stage, "normal", "expected normal stage");
		assert(Object.values(state.devcards).some(number => number), "no more development cards");
		const hand = find(state.hands, { username: event.username });
		consumeResources(hand, state, {
			sheep: 1,
			ore: 1,
			wheat: 1,
		});
		assert.notEqual(state.devcards[event.devcard], 0);
		state.devcards[event.devcard] -= 1;
		hand.devcards[event.devcard] += 1;
	// } else if (event.type == "activate_robber") {
		// try:
			// for tile in new_state["tiles"]:
				// tile.pop("robber", None)
		// except LookupError:
			// pass
		// tile = find(new_state["tiles"], x=event["x"], y=event["y"])
		// tile["robber"] = True
		// if event["target_user"] is not None:
			// my_hand = find(new_state["hands"], username=event["username"])
			// my_resources = my_hand["resources"]
			// other_hand = find(new_state["hands"], username=event["target_user"])
			// other_resources = other_hand["resources"]
			// if event["resource"] is not None:
				// other_resources[event["resource"]] -= 1
				// my_resources[event["resource"]] += 1
		// return new_state
	// } else if (event.type == "discard_resources") {
		// # TODO: update whether players need to discard anymore
		// hand = find(new_state["hands"], username=event["username"])
		// for resource_kind in event["resources"]:
			// hand["resources"][resource_kind] -= 1
		// return new_state
	} else if (event.type == "admin_give") {
		if (!session.internal) {
			event.username = session.username;
		}
		v.assert(v.object({
			type: v.literal("admin_give"),
			username: v.pipe(v.string(), v.value(state.current_user)),
			target_user: v.pipe(v.string(), v.picklist(state.user_order)),
			resources: v.optional(v.object(v.entriesFromList(
				"brick,ore,sheep,wheat,wood".split(","),
				v.pipe(v.optional(v.number()), v.integer(), v.minValue(0)),
			))),
			devcards: v.optional(v.object(v.entriesFromList(
				"invention,knight,monopoly,road_building,victory_point".split(","),
				v.pipe(v.optional(v.number()), v.integer(), v.minValue(0)),
			))),
		}), event);
		const hand = find(state.hands, { username: event.target_user });
		for (const [resource, count] of Object.entries(event.resources ?? {})) {
			hand.resources[resource] += count;
		}
		for (const [devcard, count] of Object.entries(event.devcards ?? {})) {
			hand.devcards[devcard] += count;
		}
	} else {
		assert.fail("unknown event type");
	}
}
// presto case number refund monthly pass for blocked card
// cas431144g8g6105
// within 5 business days

// 786674968

/*
{"type":"init","tiles":[{"x":-6,"y":0,"resource":"sheep","number":2},{"x":0,"y":-6,"resource":"sheep","number":6},{"x":4,"y":4,"resource":"wheat","number":5},{"x":-8,"y":4,"resource":"wheat","number":12},{"x":2,"y":-4,"resource":"brick","number":3},{"x":4,"y":-2,"resource":"wheat","number":10},{"x":0,"y":6,"resource":"wood","number":10},{"x":0,"y":0,"resource":"sheep","number":9},{"x":4,"y":-8,"resource":"wood","number":9},{"x":-6,"y":6,"resource":"ore","number":8},{"x":-2,"y":-2,"resource":"brick","number":3},{"x":-2,"y":4,"resource":"desert","robber":true},{"x":-4,"y":8,"resource":"ore","number":11},{"x":-4,"y":-4,"resource":"wood","number":11},{"x":6,"y":-6,"resource":"wheat","number":8},{"x":8,"y":-4,"resource":"wood","number":4},{"x":-4,"y":2,"resource":"ore","number":5},{"x":6,"y":0,"resource":"brick","number":6},{"x":2,"y":2,"resource":"sheep","number":4}]}
{"type":"roll","username":"billy","dice_outcome":{"first":5,"second":2}}
{"type":"build_settlement","username":"billy","x":6,"y":-2}
{"type":"build_settlement","username":"billy","x":-2,"y":0}
{"type":"end_turn","username":"billy"}
{"type":"roll","username":"rob","dice_outcome":{"first":5,"second":2}}
{"type":"build_settlement","username":"rob","x":4,"y":-4}
{"type":"build_settlement","username":"rob","x":-6,"y":2}
{"type":"end_turn","username":"rob"}
{"type":"roll","username":"oscar","dice_outcome":{"first":3,"second":4}}
{"type":"build_settlement","username":"oscar","x":-2,"y":-4}
{"type":"build_settlement","username":"oscar","x":-8,"y":6}
{"type":"end_turn","username":"oscar"}
{"type":"roll","username":"walter","dice_outcome":{"first":5,"second":6}}
{"type":"build_settlement","username":"walter","x":2,"y":4}
{"type":"build_settlement","username":"walter","x":-2,"y":6}
{"type":"end_turn","username":"walter"}
{"type":"roll","username":"billy","dice_outcome":{"first":4,"second":5}}
{"type":"activate_robber","username":"billy","target_user":"oscar","x":-2,"y":-2,"resource":"wood"}
{"type":"end_turn","username":"billy"}
{"type":"roll","username":"rob","dice_outcome":{"first":3,"second":6}}
*/

try {
	const contents = fs.readFileSync(filename, { encoding: 'utf8' });
	for (const line of contents.split("\n")) {
		if (line.trim() == "") {
			continue;
		}
		const event = JSON.parse(line);
		const state = JSON.parse(JSON.stringify(events.at(-1).state));
		apply(event, state, { internal: true });
		events.push({ ...event, state });
	}
	console.log(`Success loading save file: ${filename}`);
} catch (err) {
	console.error(`Error loading save file: ${filename}`, err);
	// const event = {
		// type: "init",
		// tiles:[{"x":-6,"y":0,"resource":"sheep","number":2},{"x":0,"y":-6,"resource":"sheep","number":6},{"x":4,"y":4,"resource":"wheat","number":5},{"x":-8,"y":4,"resource":"wheat","number":12},{"x":2,"y":-4,"resource":"brick","number":3},{"x":4,"y":-2,"resource":"wheat","number":10},{"x":0,"y":6,"resource":"wood","number":10},{"x":0,"y":0,"resource":"sheep","number":9},{"x":4,"y":-8,"resource":"wood","number":9},{"x":-6,"y":6,"resource":"ore","number":8},{"x":-2,"y":-2,"resource":"brick","number":3},{"x":-2,"y":4,"resource":"desert","robber":true},{"x":-4,"y":8,"resource":"ore","number":11},{"x":-4,"y":-4,"resource":"wood","number":11},{"x":6,"y":-6,"resource":"wheat","number":8},{"x":8,"y":-4,"resource":"wood","number":4},{"x":-4,"y":2,"resource":"ore","number":5},{"x":6,"y":0,"resource":"brick","number":6},{"x":2,"y":2,"resource":"sheep","number":4}],
	// };
	// const state = JSON.parse(JSON.stringify(events.at(-1).state));
	// apply(event, state, { internal: true });
	// persist(event, state);
}

wsserver.on('connection', ws => {
  const session = { ws, state: "login" };
  ws.on('message', data => {
    console.log({ data: data.toString(), session });
    try {
			const event = JSON.parse(data);
			if (session.state == "login") {
				if (event.type == "login") {
					// ensure user isnt already in sessions
					assert(![...sessions.values()].some(({ username }) => username == event.username), "username already connected");
					session.username = event.username;
					session.state = "game";
          ws.send(JSON.stringify({
						type: "game_state",
						state: events.at(-1).state,
					}));
          ws.send(JSON.stringify({
						type: "login_accept",
						username: session.username,
					}));
					sessions.add(session);
				} else {
					assert.fail("unknown event type");
				}
			} else if (session.state == "game") {
				if (event.type == "logout") {
					sessions.delete(session);
					session.state = "login";
					ws.send(JSON.stringify({ type: "logout_accept" }));
				} else {
					const state = JSON.parse(JSON.stringify(events.at(-1).state));
					apply(event, state, session);
					persist(event, state);
				}
			} else {
				assert.fail("unknown session state");
			}
    } catch (err) {
			console.error(err);
      ws.send(JSON.stringify({
        type: "debug",
        reason: "invalid event",
        _jserror: err.toString(),
      }));
    } finally {
      return;
    }
  });
  ws.on('error', err => {
    console.error({ err });
  });
  ws.on('close', () => {
    sessions.delete(session);
  });
});

server.on('request', (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
  });
  fs.createReadStream('index.html').pipe(res);
});

const port = 8080;
server.listen(port);
console.log(`Server started on port ${port}`);
