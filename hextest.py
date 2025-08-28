# q is the top left to bottom right x axis, r is the y axis
# some spots are hexes, some are edges, some are nodes, some are meaningless
# 0, 0 is the central hex
def kind(q, r):
    if q%2 == 0 and r%2 == 0:
        if (q-r)%6 == 0:
            return "hex"
        else:
            return "node"
    elif (q-r)%3 == 0:
        return "edge"

print("regular")
rr = range(20)
for y in rr:
    for x in rr:
        print(end={"hex":"x", "node":"o", "edge":"."}.get(kind(x,y)," ")+" ")
    print()
print()

print("flat")
rr = range(20)
for y in rr:
    print(end=" "*y)
    for x in rr:
        print(end={"hex":"x", "node":"o", "edge":"."}.get(kind(x,y)," ")+" ")
    print()
print()

print("pointy")
rr = range(12)
for y in rr:
    for y in (y, y+0.5):
        # print(end=" "*y)
        for x in rr:
            print(end={"hex":"x", "node":"o", "edge":"."}.get(kind(x,y-x/2)," ")+"  ")
        print()
print()

# dx is horizontal, dy is top left to bottom right
def hex_move(q, r, dx, dy):
    return (
        q + 4*dx + 2*dy,
        r - 2*dx + 2*dy,
    )
def make_game(hex_indices: list[tuple[int, int]]):
    hex_indices = [hex_move(0, 0, dx, dy) for dx, dy in hex_indices]
    assert all(kind(q, r) == "hex" for q, r in hex_indices)
    return {
        "hexes": {(q, r): {} for q, r in hex_indices},
        "edges": {
            (q+dq, r+dr): {}
            for q, r in hex_indices
            for dq, dr in [(+1,-2), (+2,-1), (+1,+1), (-1,+2), (-2,+1), (-1,-1)]
        },
        "nodes": {
            (q+dq, r+dr): {}
            for q, r in hex_indices
            for dq, dr in [(0,-2), (+2,-2), (+2,0), (0,+2), (-2,+2), (-2,0)]
        },
    }

game = make_game([
    (0, -2), (1, -2), (2, -2),
    (-1, -1), (0, -1), (1, -1), (2, -1),
    (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0),
    (-2, 1), (-1, 1), (0, 1), (1, 1),
    (-2, 2), (-1, 2), (0, 2),
])
X = []
Y = []
for k, qrs in game.items():
    for q, r in qrs:
        # assert kind(q, r) in k, (k, q, r, kind(q, r))
        X.append(q)
        Y.append(r*2 + q)
print("catan board pointy")
print("y:", min(Y), max(Y), "x:", min(X), max(X))

for y in range(min(Y), max(Y)+1):
    for x in range(min(X), max(X)+1):
        q, r = x, (y - x)/2
        k = " "
        for kind, coords in game.items():
            if (q, r) in coords:
                k = {"hexes":"x", "nodes":"o", "edges":"."}[kind]
        print(end=k[0]+"  ")
    print()
print()
