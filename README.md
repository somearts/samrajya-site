# Samrajya: Kaalchakra

**Empires rise. Time turns.**

A two-player strategy game on a board of twenty-eight tiles. This is **phase 1**:
the board itself, the choice of civilisation, and the way two players get onto
it together. There are no rules on it yet — no dice, no movement, no property,
no money — and nothing here pretends otherwise.

Live at **https://golake.app/samrajya/**

---

## What is here

| | |
| --- | --- |
| **Live at** | `https://golake.app/samrajya/` |
| **Cloudflare Worker** | `golake-samrajya` (account `e8521ba8…`) |
| **Routes it owns** | `golake.app/samrajya`, `golake.app/samrajya/*` |
| **Bindings** | `ASSETS` (static assets), `GAME_ROOM` (Durable Object class) |
| **Databases** | none |
| **Secrets** | none |

This is a **separate Worker** from GoLake (`odd-snow-0a72`, which holds
`golake.app` as a custom domain) and from Strand (`golake-strand`). It is
reached only under `/samrajya/*`, so nothing else on the domain can reach it,
and deploying it cannot touch anything else on the domain.

## What is not here yet

The game. No dice, no movement, no ownership, no transactions, no turns.

The tiles are numbered around the perimeter in the order a game will travel
them — START, then clockwise, which is the direction START's arrow points. That
numbering is the only concession to a future that is not written yet, and it
costs nothing now: when there is movement, a tile's place on the board is the
same fact as its place in the turn order, and it will not have to be worked out
a second time.

## The board

Twenty-eight tiles: **four corners and twenty-four intermediate**, six on each of
the four sides. A large empty centre, four rounded outer corners, a black
four-pointed star on a horizon line in the middle.

### How the geometry is guaranteed

It is declared once, in `board.css`:

```css
grid-template-columns: var(--corner) repeat(6, 1fr) var(--corner);
grid-template-rows:    var(--corner) repeat(6, 1fr) var(--corner);
grid-template-areas:
  "tl t1 t2 t3 t4 t5 t6 tr"
  "l1 c  c  c  c  c  c  r1"
  …                                    …   "bl b1 b2 b3 b4 b5 b6 br";
```

Two corner tracks and six `1fr` tracks. **Because `1fr` is by definition the same
for every track, all twenty-four intermediate tiles are identical by
construction** — there is no code that could make them differ, and nothing to
keep in step. The centre spans six of those same tracks, so it is square without
anybody working it out. `board.js` names the twenty-eight cells and hands each
tile its own; `check-assets.js` reads both files and fails if they ever disagree.

`--corner: 16.85%` is the reference's own proportion: a 1157px board has 195px
corners and 128px intermediate tracks, which is 16.85% and 11.05%, and
2 × 16.85 + 6 × 11.05 is the whole board.

Everything inside the board is sized in **`cqw`** — a percentage of the board,
not of whatever box it happens to sit in. That is what keeps all twenty-four
stars identical whether they are on a portrait tile or a landscape one.

### Everything is measured, not asserted

`npm run test:e2e` measures the rendered board and fails on any of this:

- 28 tiles, 4 corners, 24 intermediate, **no area used twice**
- all 24 intermediate tiles within 0.6px of each other
- all 4 corners within 0.6px of each other, and square
- 12 portrait and 12 landscape — the same tile, turned
- the board is square
- **the centre is exactly what the tiles leave**: `board = 2·pad + 2·gap + 2·corner + centre`,
  stated as arithmetic rather than as a tolerance, so it cannot pass at one size
  and fail at another
- no horizontal overflow, no scrolling, the whole board on screen
- no corner name or mark reaches outside its own tile

## The four corners

| | |
| --- | --- |
| top left | **OMEGA** — the open ring and its two feet |
| top right | **AKASH CORE** — a circle on a vertical axis with a point at its centre |
| bottom left | **START** — an arrowhead and a stem, pointing where the game goes |
| bottom right | **MARKETPLACE** — three discs stacked |

All four are hairline drawings on a 48-unit grid in `corner-art.js`, in the same
weight and the same one-stroke discipline as the wordmark. Each is `currentColor`.

The names are set in Jost at a size that **fits the tile it is in** — eleven
characters have to fit whatever the tile happens to be, and at 320px they only
just do. Sized against the board instead, they would fit on a desktop and run
straight over the neighbouring tile on a phone, which is the one screen this has
to work on.

## The spaces

Six of the board's twenty-eight cells are **property cards**. They are described
as data in `shared/spaces.js` and drawn in `assets/js/art.js` — no image is
downloaded, nothing is a photograph, nothing is an icon.

> **The left edge is numbered from the top.** `l6` is the cell directly **above
> START** and `l1` the cell directly **below OMEGA** — the opposite of what the
> names suggest. Pluto was once at `l1`, and was therefore sitting under OMEGA.
> The suite now measures where tiles actually meet (`START.bottom` vs
> `Pluto.bottom`, `OMEGA.bottom` vs `Atlantis.top`) rather than trusting this
> comment or anyone reading it carefully.

Walking **up from START**: Pluto, Halley's Comet, Ragnarok, Dwarka, Mount
Kailash, Atlantis, then OMEGA. Prices rise with the walk.

| cell | | name | price | bar |
| --- | --- | --- | --- | --- |
| `l6` | property | **PLUTO** | ₹200 | amber |
| `l5` | property | **HALLEY'S COMET** | ₹260 | amber |
| `l4` | arsenal | **RAGNAROK** | — | green |
| `l3` | property | **DWARKA** | ₹320 | green |
| `l2` | property | **MOUNT KAILASH** | ₹380 | green |
| `l1` | property | **ATLANTIS** | ₹500 | green |

### The card system

Each card is the same three things in the same places, in whichever direction its
own cell runs:

```
the title     centred, in the quiet band between drawing and sky
the drawing   rising from the foot of the card, dissolving upward
the band      full width, flush along the foot of the card
```

The card is a **grid with two rows**: everything above the band, and the band.
The drawing spans both, so it *is* the card and is cut off by it - the sky at
the top of the picture is the paper, and the title and the band are drawn over
it. Giving the drawing a row of its own would put the picture in the upper half
of the card while the compositions themselves are drawn to sit in the lower
half, and the two would contradict each other.

**The band is a plinth, not a label.** It used to be a small floating rectangle
sitting under the name, and it read as debris - the thing the redesign was
complaining about. As the card's own foot, full-bleed and flush with the bottom
edge, it reads as part of the object: the surface the card stands on. A bar with
air on either side of it is a sticker on a card; a bar that runs edge to edge is
a piece of the card.

**The title is centred, and the pill is drawn around it.** The pill is not a box
that happens to sit behind the name: it is sized to hold it. Every card in a
format uses one pill geometry - one position, one height, one radius - and the
padding is not a number anyone chose but whatever is left of that height once
the measured ink has taken its share, applied to all four edges. So the title
sits the same distance from every border on every card, and the two cannot
drift apart, because neither of them is ever typed in by hand.

The baseline is *derived*, never authored. This is the whole fix for a family of
faults that are easy to commit and hard to see coming: give a card a larger font
and leave its baseline where it was, and the type grows upward out of a pill
sized for something smaller. It happened here - Pluto's cap-top ended up above
its own pill, and Jupiter's and Moon's followed - and the structural answer beat
twelve separate corrections that would have drifted apart again.

Each card is set at the largest size its own width allows, tracking opened up
only as far as it must be: on a narrow card a larger title with tighter letters
reads far better on a phone than a small one with airy ones.

**One ink, one ground, one colour.** The six drawings share a single warm
sepia-grey ramp of eight steps, darkest `#241f19`, lightest `#f7f3ea`, and every
card sits on the board's own ivory. The band is the only saturated thing on any
of them - which is what makes it worth having. Six tinted grounds were tried
first and turned one edge of the board into a row of coloured stickers. The suite
fails if any illustration contains a colour outside the shared ink.

**The dissolve.** Every drawing is masked by a gradient that fades it out across
the top of its area, so each picture emerges out of the paper instead of being
laid on it with an edge. On Mount Kailash it is tuned to complete across the two
far ridges and leave the near two solid, which is what atmospheric perspective
does with a mask instead of with four layers of white.

**No ornament.** The reference's diamond-and-rule beneath each title is gone and
nothing has replaced it. The plate contains exactly one element: the name.

### Twelve horizontal and twelve vertical

A cell in the left or right column is `(corner track) x (1fr track)`. The same
cell in the top or bottom row is `(1fr track) x (corner track)`. Those are
**transposes of one another**, so on a square board exactly one of the two is
landscape, and the board carries twelve horizontal property cards and twelve
vertical ones.

This was tried the other way. A version of this board was made taller than it is
wide - `W/H = 0.686`, corner at 15% - so that all twenty-four could be vertical.
Writing the condition out, with square corners of side `s` on a `W x H` board:

```
left/right portrait  iff  s < H/8
top/bottom portrait  iff  s > W/8
```

Both hold at once only while `W/8 < s < H/8`, which is **empty when `W == H`**. So
a rectangular board can give all four sides the same orientation, and it was
built and then withdrawn. The costs were: a board 1.46x taller than it is wide,
a centre that became a tall empty rectangle, and cards that had to render at two
sizes - 109x138 down the sides, 83x109 along the top and bottom - to keep a
single proportion. None of that is recorded to relitigate it. It is recorded
because it is the reason the mixed orientation is *kept* rather than rediscovered.

The card component serves both shapes deliberately: `data-axis` on the tile says
which way that cell runs, and a portrait cell is served by turning the drawing
ninety degrees rather than by cropping it.

### The size, in one line

Every measurement is a fraction of **its own tile**, not a number and not a
fraction of the board. The tile is its own container, so `cqw` means one per cent
of that tile, and the whole card scales as one piece from a 320px phone to a
desktop with no breakpoint anywhere. A side cell is **135 x 86 pixels**, which is
why every illustration is drawn on `100x64` - the cell's own proportion, so
nothing is letterboxed and nothing is aligned by eye.

### What makes a 135px drawing good

At that size there is no room for detail, and detail would be the wrong thing
anyway. What is left is four things, and these six do all four:

- **silhouette** - the outline has to be worth looking at on its own. A polygon
  is not a mountain.
- **depth** - three or four distinct values, each plane lighter than the one in
  front of it. Depth is separation, not shading.
- **air** - the subject does not fill the frame. A thing that touches all four
  edges has nowhere to be.
- **restraint** - one idea per card. Dwarka and Atlantis are the same
  architecture and opposite stories, and they are told apart by four units of
  arch, not by a different drawing.

And one rule that costs nothing and does more than any of them: **the light comes
from the upper left on all six, without exception.** It is the cheapest way to
make six separate drawings look like one set.

The card is wide and the title is centred across nearly all of it, so the upper
fifth of every drawing belongs to the type. That is not a compromise - it is the
same division a printed plate has. The subject sits below it and the dissolve
happens along the join.
### ₹

`₹` is U+20B9, outside the Latin subset Google fonts ship by default. The
board's Jost does carry it. Prices are **not printed on the cards** — they are
dealt in the middle of the board — but the price is still *known* in
`shared/spaces.js` and carried on each tile as `data-price`, so nothing has to be
re-decided when the middle starts showing them.
## The four civilizations

**Indus Valley · Mesopotamian · Ancient Egyptian · Aztec.** These replaced the
token picker the entry stage used. Nothing was carried across: a tiger and a
lotus are pieces, and a civilisation is a people, and the two do not belong in
the same field of the same record.

There are **no marks on the options yet.** The civilisation *tokens* are a later
phase, and inventing four symbols now would be inventing them in the wrong place
and then redrawing them. What is here is the choice, which is what this phase
needs to carry.

## Getting onto the board

1. **Create Game** → your name → your civilisation → the room opens with a
   four-digit code
2. **Join Game** → that code or the link → *your* name → *your* civilisation
3. The host presses **Start Game** and both screens open the board, in the same
   room and on the same turn, without either asking or refreshing

Each player fills in **only their own** name and civilisation, on their own
device. The creator used to reserve a second seat and describe an opponent they
had not met yet; that is gone, and the seat is now filled by the person sitting
in it.

The lobby is the room: the code in four tiles, the link to send, both seats with
their colours and **Ready**, and one line saying what is being waited for. The
link comes in two shapes - `?room=7889` and `/samrajya/7889` - and both serve the
game; the page reads the number and then takes it back out of the address, so a
refresh lands in the room this tab is in rather than in an old link. The host's
Start Game is shut until the other seat is taken; the guest's button says who it
is waiting for. When the host starts, the socket moves both players to the board
at once - there is no "enter the board" step, and no way to be half in.

Each player's name and civilisation sit in a strip **above** the board, not on
it: the board in the reference is a finished drawing and two player identities
are not part of it.

---

## Running it

```bash
npm install
npm run dev          # build, then serve on http://127.0.0.1:8787
```

Everything else:

```bash
npm test             # the shared rules, in unit tests
npm run check        # build, then verify every path that ships resolves
npm run test:e2e     # drive both flows in a real browser, at a phone size
npm run deploy       # build and deploy
npm run verify       # check a deployed site end to end
```

Two more, for this site in particular:

```bash
node scripts/golake-baseline.js check     # prove the GoLake home page is intact
node scripts/shot.mjs <url> <out.png> [w] [h]
node scripts/shot.mjs <url> --measure [w] [h]   # what the layout actually measured
node scripts/cf-do.mjs sweep              # what is on the Cloudflare account
```

`shot.mjs` renders through the DevTools Protocol with a real emulated viewport,
because Chrome on Windows clamps an ordinary window to a 500px minimum width —
headless or not — so a "390px phone" render comes back as a 500px layout cropped
to 390, which looks exactly like a horizontal overflow and is not one.

Both bugs in the board's geometry were found by *measuring* the rendered board
rather than reading it, and `scripts/e2e.js` now does that on every run. That is
also why the corner marks are drawn on a 48-unit grid and the wordmark on a
100-unit one: a drawing whose proportions can be checked has a chance of being
checked.

---

## How it is put together

```
authored/samrajya/     the site, as written
  index.html           one document, five screens, no navigation between them
  assets/css/
    kalchakra.css      the welcome screen and the panels
    board.css          the board, and only the board
  assets/js/
    app.js             the state machine: screens, steps, what each button does
    views.js           the five screens, state in -> DOM out. Decides nothing.
    board.js           the twenty-eight tiles and the centre
    corner-art.js      the four corner marks
    wordmark.js        SAMRAJYA and KALCHAKRA, drawn
    session.js         the only file that talks to the network
    dom.js             el(), and moving focus when a panel appears

shared/                rules both sides must agree on
  civilizations.js      the four
  identity.js          name rules, room-code shape, player identity

src/                   the Worker
  index.js             routing, and deriving a room's address
  room.js              the Durable Object: two seats, and nothing else
```

### The wordmark is drawn, not typed

The approved lettering has an **A with no crossbar** — a lambda. That single
detail is the character of the mark, and no stock geometric sans supplies it: a
typeface would either add a crossbar nobody approved or substitute a face that
reads as a different logo.

So all seventeen letters of SAMRAJYA and KALCHAKRA are drawn as stroke paths on
a shared 100-unit cap height in `wordmark.js`, and used everywhere the mark
appears. They are `currentColor`, hairline weight, and scale from a 320px phone
to a 4K display without a hint of the pixel grid.

Everything else on the page is set in **Jost**, self-hosted from Google Fonts —
three weights, latin subset, about 30 kB total. Futura-adjacent, which is what
the rest of the composition wants, and no third-party request is made.

### One page, four screens

`welcome → create → lobby` and `welcome → join → lobby`. There is no router and
no page load between them: the welcome composition is replaced by a panel in
the same document. Going back never costs you what you typed.

A refresh is not a navigation. If this browser is sitting in a room, it is put
back in that room.

### The identity is a secret, not an account

On first load the browser mints 128 random bits into `localStorage` and sends
them in `x-samrajya-player`. There is no registration, no password, no email,
nothing to sign in to.

That secret grants nothing by itself. It only ever proves *"I am the browser
that was given that seat"*, which is what makes a refresh return a player to
their own game instead of stranding them.

### A room's address is derived, not drawn

`roomId = H(identity, createKey)`, where `createKey` is another 128 bits kept
until the create succeeds and then thrown away. The consequence is the whole
point: **asking twice is the same room**, so a double-tapped Create cannot open
two games. There is no lock, no index and no table of recent requests, because
there is nothing to look up — the second request arrives at the room the first
one made.

### Why a Durable Object

One object per game. A single object handling a room at a time is what makes a
move atomic — the two players cannot act on the same room in the same instant,
because the object will not run two requests at once. That property is needed
the moment money can change hands, which is to say: for the board.

It is the same architecture the previous version used, and the same one Strand
uses a variant of. That is the one thing deliberately carried over.

The lobby's WebSockets are accepted **through the hibernation API**, so a room
nobody is looking at lets the object be evicted. Sitting in a lobby therefore
costs nothing while you wait — which is the only reason a live channel is
affordable on a free plan.

---

## The rules of the room

The server decides everything. The browser is a renderer with an opinion about
nothing.

- **Two seats.** That is the game. There is no third.
- **A room code is four digits**, `1000` to `9999` — a table number, not a
  password. It is short enough to read across a room and type with a thumb, and
  four tiles on the lobby make it a number rather than a word.
- **Only the host reserves anything, and that is their own seat.** Each player
  names themselves and picks their own civilisation on their own device, so
  there is no "describe your opponent" step and no default to overwrite.
- **A number is only reused when its room is genuinely gone.** A lobby nobody
  started is reclaimable after two hours, and any room after a week; anything
  fresher refuses and the create walks to the next number. Four digits is a
  small shopfront, so the numbers are recycled deliberately rather than
  abandoned.
- **A token is held by one player.** The joiner is shown the tokens that are
  gone rather than being offered them and refused.
- **A room's state is readable by anyone holding the code.** There is nothing
  secret in who has taken which seat, and the join screen has to be able to show
  it. Seats are *claimed* by an identity, never by knowing a code.
- **A refresh is not a new seat.** Joining again with the same identity returns
  the seat it already has, and the room it belongs to.
- **The code is taken out of the address bar once it has been read.** A shared
  link is a way in, not a place this browser lives: with the code still in the
  URL, a refresh could reopen the previous game after the host had started a
  new one. From then on this tab knows its room from its own storage.

### API

```
POST   /samrajya/api/rooms                    open a room, take seat 1
GET    /samrajya/api/rooms/:code              read the room
POST   /samrajya/api/rooms/:code/join         take seat 2, as yourself
POST   /samrajya/api/rooms/:code/action       one game action; `start` begins it
GET    /samrajya/api/rooms/:code/live         a socket, told when it changes
```

Every request except `/live` carries `x-samrajya-player`. Refusals are
`{ error, code }` with a message meant for a person, and the screens show it
rather than guessing at it — including "No such game." for a four-digit number
nobody is sitting at, which is a typo and not a fault.

`/live` is the one that cannot carry the header, because a browser cannot set
one on a WebSocket. It sends room contents and no seat — see
[Findings](#1-the-lobby-polled-every-three-seconds--fixed).

---

## Where the board goes

This is the shape of the work, so the next stage is additive rather than a
rewrite:

| | Now | With the game |
| --- | --- | --- |
| `room.js` | seats, status, a clock | + a `board` record, moved and rolled back in the same single-threaded object |
| `#view()` | returns `board: null` | returns the real thing |
| `session.js` | create / join / room / subscribe | + one method per game action |
| `app.js` | five screens | + turns, dice, trading |
| `board.js` | 28 tiles, numbered in turn order | + ownership, on the tiles that already exist |
| `views.js` | welcome, create, join, lobby, board | + whatever the rules need |

Nothing else moves. The twenty-eight tiles are already numbered in the order a
game travels them, the centre already receives the room's state, and the live
socket already pushes it. The transport a game needs is already in place and
already tested.

---

## Verification

Before this phase was called done, on the **deployed** site, not the dev one:

- **66 production checks** — `npm run verify`
- **85 end-to-end browser checks** at 320, 390, 768 and 1440 wide —
  `npm run test:e2e`
- **30 unit tests** on the shared rules — `npm test`
- **57 asset checks**, including the board's two grids agreeing — `npm run check`
- **GoLake integrity** — `node scripts/golake-baseline.js check`
- **The welcome screen** — `npm run verify:welcome`

The end-to-end suite drives two genuinely separate browsers with separate
storage, so the second player really is a second player and not the first one
looking in a mirror.

The welcome screen is still the one that was approved. This used to be a
SHA-256 written in this file and checked by hand, which is a memory rather than
a guarantee — and this phase changed the same client that draws the board on
the same page, so "checked by hand" was not good enough. It is a check now:
`welcome-baseline.js` compares three things that must agree — the authored
`index.html`, the stored capture in `welcome-baseline.json`, and the live page —
after stripping what Cloudflare injects per request. `verify-live.js` runs the
same comparison, so `npm run verify` covers it too.

---

## Findings, and what was done about them

Three things were found and written down when the entry stage shipped. Two have
been fixed since. All three stay here, because a finding that quietly disappears
when it is dealt with is a finding nobody learns from.

### 1. The lobby polled every three seconds — **fixed**

> *Found: the lobby asked the server every three seconds whether the other
> player had arrived. Adequate for two people waiting for each other; not what a
> board wants.*

The room now carries a **WebSocket**. A socket is accepted through the Durable
Objects hibernation API, so an unattended room costs nothing, and every change
is pushed the moment it happens. Measured in the browser suite: **0ms**, against
a 3000ms floor before — and the suite also asserts the number of reads the
lobby's own screen makes does not go up while it waits, so the arrival cannot
have come from a timer.

`npm run verify` proves the same thing at the API level: a socket is opened, a
second player joins over HTTPS, and the watcher is handed the new state.

**What still holds.** The socket carries no seat. A browser cannot put a header
on a WebSocket, and the only thing that could stand in for one — the identity,
in the query string — would end up in a URL and then in an access log. So the
socket sends the room the way anyone holding the code already sees it, and the
client keeps the seat it already knows it has. **Seats are still claimed and
confirmed only over HTTPS**, where the header is.

### 2. A double-tapped Create could make two games — **fixed**

> *Found: double-clicking Create is prevented in the browser, not the server. The
> button disables on the first tap, but nothing stops a second `POST /rooms`
> from the same identity creating a second room.*

A browser disabling its own button is not a server-side guarantee, and it is not
the thing that should have been relied on. The fix is not a lock or a table of
recent requests: **a room's address is now derived from the pair
`(identity, createKey)` rather than drawn at random**, so two identical requests
are *the same room by construction*. The second one arrives at the object that
is already there, finds the key the room was created with, and returns it
untouched.

Proved two ways: the browser taps the button three times in one tick and the
room is found with exactly one seat in it; and `npm run verify` fires **five
genuinely concurrent** creates and gets one room back from all five.

Nothing is given up by deriving rather than drawing — both inputs are 128 random
bits that never leave the browser, so the code carries the same ~39 bits of
entropy as before. And "Start over" clears the key, so the same person can still
start a second game; that is asserted too, because a fix that made a second game
impossible would not be a fix.

### 3. The Elephant and Peacock were weak — **redrawn, and no longer used**

> *Found: the elephant and peacock are line drawings at 24px. They read
> correctly, but they are the weakest marks here.*

Both are redrawn, and the failure was found by rendering them large rather than
by reading the paths: the peacock was **a tree** — a round vane on a stalk with
symmetric barbs — and the elephant was a **koala**, then a **moth**, then an
**owl**, because a round head with a lobe on either side and two dots reads as a
face no matter how it is proportioned. The fixes were a vane twice as long as
it is wide, and a profile with a long tapering trunk.

**What still holds.** They were a fix, not a foundation: this phase replaced
them outright. Four **civilisations** stand where four tokens did, and they
carry no marks at all — the tokens are a later phase and inventing four symbols
now would be inventing them in the wrong place and then redrawing them.

### 4. Corner labels had nowhere to go on a phone — **fixed, and kept as a check**

> *Found while building the board: the reference's corner labels are about 7.7%
> of their tile, which at a phone's 62px corner is a 5px letter. Reproduced
> faithfully, they overflowed into the neighbouring tile.*

The names are now sized against **their own tile** rather than the board, so
the longest of the four — eleven characters, whether AKASH CORE or MARKETPLACE —
always fits, at any size, with a floor underneath so they stay words rather
than textures. The end-to-end suite measures whether any name or mark reaches
outside its tile, at every viewport, so it cannot come back quietly.

### 5. The board's own geometry was wrong twice — **both caught by measuring

> *Found: `grid-template-areas` assigned from script with bare cell names is
> silently rejected by the CSSOM. The board fell apart into implicit tracks and
> every tile measured the same size at the wrong place. Later, the tile stars
> were sized with a percentage, which inside a grid item resolves against the
> tile — not the board — so a mark was a third of its intended size on a
> portrait tile.*

Neither was visible in the markup and neither would have survived review by
reading. Both were found by measuring the rendered board, which is now what the
suite does. **The template moved into the stylesheet**, where it can be read and
edited and does not depend on a runtime assignment working.

### 6. The group's colour was there, but faded to nothing — **fixed**

> *Found while designing the six spaces: the brick band was drawn at 0.26
> opacity, on the reasoning that a restrained board wants restraint. Rendered, it
> was a tint of the paper — the two tiles were not a group, because a group
> signalled by a tint is no group.*

The reasoning was right and the number was wrong. Restraint on this board comes
from **how many tiles carry a colour — two out of twenty-eight — not from how
faint those two are**. The band is now solid, and the ungrouped properties carry
an explicit 0.18 ink instead, which is where the faintness actually belongs.
Both are checked: the band's computed opacity, and its saturation, so a near-black
that happens to have a red channel one step higher cannot pass for a colour again.

### 7. A CSS custom property set by assignment, silently dropped — **fixed**

> *Found while building the six spaces: `--space-colour` was applied through
> `Object.assign(node.style, …)`. Custom properties are not entries on a style
> object, so that assignment does nothing at all — no error, no warning — and
> every band fell back to the board's ink.*

The symptom was invisible and the cause was invisible: the colour looked wrong
and the code looked right. `dom.js` now has a `setStyle` that routes `--*` through
`setProperty`, with the reason written down next to it. **This one nearly escaped**
— the band check was passing, because near-black ink is a legal CSS colour and
`saturation > 0.1` is true of it.

### 8. Half-frozen data is not frozen data — **fixed**

> *Found by a test written for this phase: `Object.freeze(SPACES)` stops a caller
> replacing `l1`, but `SPACES.l1.price = 1` still worked, because each space is a
> separate object. The board's prices were mutable by accident.*

`deepFreeze` now walks the whole structure. Worth recording because the test that
caught it was written to check a *design* rule and found an *integrity* bug
instead — which is the argument for asserting things that were not the point.

### 9. The cards look like cards — **judgement, not measurement**

> *Found by eye, confirmed by number: the first Ragnarok card sized itself to its
> contents, because `height: 100%` against an `auto` grid row resolves to `auto`.
> It sat in its tile with a wide margin above and below and a thin one at the
> sides — a mis-centred box, not a card lying on a tile.*

Fixed by giving the card one definite row. The suite now measures the margin on
all four sides and requires them even to within a pixel, because "does it look
right" is a question numbers cannot answer but can keep honest.
### 10. I reported the sequence as correct. It was not — **fixed**

> *The brief said the tile sequence was wrong. I checked the grid, said it was
> already right, and moved on to the artwork. It was wrong, and Pluto was sitting
> directly under OMEGA the whole time.*

The left edge is numbered **from the top**: `l1` is the row below OMEGA and `l6`
the row above START. I read `l1` as "first from START", which is the single
misreading that produced the wrong answer — and having reached it, I reported it
twice with confidence.

What actually caught it was measuring instead of reading. `l1.top = 293.2`
against `OMEGA.bottom = 292.2`. Adjacent. No argument about naming conventions
gets there; a box measurement does, and it is now a permanent check rather than
a thing anyone has to be careful about.

Two of my own new checks also had the same trap in them — the stacking
comparison paired `l(i)` with `l(i+1)` backwards — and one passed *vacuously*
while doing it, because `Math.abs(NaN) > 0.6` is false. A check that can pass
having measured nothing is worse than no check, so all three now require finite
numbers before they compare anything.

### 11. Photographs were tried, and removed — **code-drawn won**

> *The brief first asked for real imagery: NASA's Pluto, Giotto's Halley, a
> photograph of Mount Kailash, the sunken Lycian city at Kekova. All of it was
> fetched, licensed and credited. All of it was then deleted.*

At 62 x 40 pixels a photograph is a grey-brown blur carrying none of the detail
that made it worth choosing, and five of them drag five colour temperatures onto
a board whose entire character is that it is one drawing hand. The Pluto frame in
particular has a **black sky**, and black is not allowed on these six.

The replacement is drawn: about twenty kilobytes for six pictures, inline, no
network, no dependency, and legible at the size the board actually renders at.
This is recorded because the first attempt was the reasonable one and it was
still wrong.

### 12. A tile that was not a positioning context — **fixed**

> *Every one of the six pictures rendered at 1220 x 1300 — the entire viewport —
> filling the whole board. `position: absolute; inset: 0` had no positioned
> ancestor inside the tile, so it resolved against the board.*

Caught by the end-to-end suite measuring the artwork against the tile it is in,
which is the first time that measurement existed. `position: relative` on the
space tile, plus the check.

### 13. A black fallback where black is forbidden — **fixed**

> *`.board__tile--space` fell back to `background: var(--ink)` — a black tile —
> for the case where the script had not run.*

Written by me, in the same change that removed black from Ragnarok, and caught by
the asset check written in the same breath. It now falls back to `--paper`, which
is also the truthful failure: an undecorated tile on this board is paper.

### 14. Dwarka was painted in the group's own colour — **fixed**

> *Dwarka's warm sandstone sat within 40/255 of the Pluto–Halley terracotta. Two
> groups of warm colour next to each other on one edge of the board means the
> pair that is *supposed* to read as a group stops reading as one.*

Caught by a unit test written to assert a **design** rule and finding a **design**
fault, which is the whole argument for asserting things that were not the point.
Dwarka is now a paler, less orange champagne; the sandstone is carried by the
gate's line-work instead, where it belongs.


### 15. Two groups wanted, and the first gold was too close — **fixed**

> *Dwarka, Mount Kailash and Atlantis were given one yellow scheme. The first
> gold, `#c2a04c`, sat 31/255 from the Pluto–Halley terracotta. Two warm colours
> that close are one colour.*

The test that had already caught Dwarka drifting into the group caught the group
itself drifting into the other one. The yellow moved to `#d6b93f`, which is 107
from the terracotta and unambiguous. The assertion is now threefold: the three
yellows must be **exactly** equal, the red pair within 40 of each other, and the
two schemes more than 40 apart.

### 16. White type needed a dark bed to be genuinely high contrast — **fixed**

> *White was asked for on grounds ranging from pale champagne to deep teal. On the
> palest, white is about 1.6:1 — not high contrast at all, whatever the brief
> intended.*

Fixed by making the bottom fade on every picture **dark**, in that space's own
deep tone, instead of a tint of its ground. The name is now white semibold at
every size with the same bottom-left position on all six, and the contrast no
longer depends on which ground it landed on.


### 15b. Six tinted grounds, then a reference that settled it — **superseded, then re-settled**

> *The cards were given six coloured grounds and a maximalist Ragnarok. Both were
> deliberate, both were defended, and both were replaced.*

The tinted grounds turned one edge of the board into a row of coloured stickers:
six competing pictures, no hierarchy, and a board that stopped looking like one
object. The maximalist Ragnarok — a deep violet seal with a fan of gold blades —
was at the opposite extreme and shared nothing with the five beside it.

Both were replaced against a supplied reference: six tall cards, warm ivory, one
monochrome ink drawing each, enormous negative space. The lesson worth keeping is
not "the reference was better" but that **six coloured grounds and one
saturated exception are the same mistake twice** — six cards competing instead of
one board reading. What the reference has that the earlier work did not is a
*system*: one ink, one ground, and colour used exactly once per card.

### 16b. A bar compared in viewport coordinates — **fixed**

> *The check that all six bars are the same size and in the same place compared
> raw `left` and `top`, which differ because the six tiles are stacked down a
> column at different heights. It failed on six identical bars.*

Now measured as an offset from each tile's own top-left, which is what "the same
place" actually means. A check that fails on correct output gets deleted rather
than trusted, so it is worth saying that this one was wrong, not the CSS.

### 17. I made all twenty-four cards vertical, and it was wrong - **reverted, and recorded**

> *The board was made taller than it is wide so that every property card could be
> vertical. It cost a board 1.46x taller, a centre that became a tall empty
> rectangle, and cards rendering at two different sizes. Withdrawn.*

The geometry behind the attempt was sound and is kept in `board.css`: a side cell
and a top cell are transposes of one another, so a square board cannot make both
portrait - see *Twelve horizontal and twelve vertical*.

What was not sound was the trade. "Consistent orientation" turned out to be worth
less than "square board, square centre, one size per side", and that was never a
geometric result - it was a preference dressed up as a constraint. The proof is
the revert: **no part of the card design changed**, so the only thing that
improved was the shape of the board.

It is recorded because the transpose fact is worth keeping, and because a
withdrawn experiment that cost three builds should not be quietly re-run in two
years by someone who remembers the algebra and forgets the outcome.

The four bugs it turned up were real, had nothing to do with the layout, and are
kept - a `0 x 9.8` band, a band nested inside the title, an `fr` track that could
not shrink, and an auto column that grew 3.2px past the card. See 18 to 21.

### 17a. A sword with a guard thirty units wide read as a T-bar - **fixed**

The first Ragnarok had a crossguard spanning a third of the card over a blade
sevenths of it wide, and at 135 pixels that is a signpost, not a sword. A sword
reads off the blade being the mass and the guard being a thin accent on it.
Rebuilt with the blade at nine and a half units narrowing to four where it enters
the ground, and the guard at twenty and swept *down* at the tips - which is what
a quillon actually does. The break is a real gap with the lower half of the blade
displaced, not a zigzag on an unbroken edge: at this size a zigzag disappears and
a gap does not.

Worth writing down because **nothing in the code says it**. It is a proportion,
and proportions do not show up in a test.

### 17b. Six thin streamers read as hatching, not as dust - **fixed**

The first Halley's Comet was six tapering slivers, each computed along its own
axis with its own perpendicular so that they fanned correctly. The arithmetic was
right and the picture was wrong: six thin lines of near-equal weight read as a
bundle of straws. Rebuilt as **one broad shape** with a gradient fading along its
length and narrowing to a point, with three darker filaments *inside* it - which
is where the structure in dust actually is - and one thin bright filament on the
axis between them. The silhouette went from a wedge to a comma, and that is the
whole difference between a comet and a swoosh.

### 17c. A polygon put on top of a gradient creased it - **fixed**

Pluto was given a second, large dark shape to suggest the night side, filled with
a transparent-to-dark gradient. The gradient is fine; the problem was that the
shape had a **straight top edge**, and a straight edge laid over a curved body
reads as a fold in the paper. The depth went back into the body gradient, where it
belongs and where there is no edge to see.

### 18. `place-items: center` silently collapsed the band to zero width - **fixed**

The base tile rule centres its contents, which is right for a mark in the middle
of a tile. Inherited by the card, it collapsed the band to **0 x 9.8** - a bar
with no width at all - and stopped the drawing filling the card. The band's
height was correct, so the band *looked* right in a screenshot at a glance and
only the measurement caught it. Cards override it with `place-items: stretch`.

### 19. A band is not a child of the title - **fixed**

The band was built inside the title's plate, and styled with `grid-row: 3` - a
rule that did nothing, because it was not a grid item. It became a zero-width
flex box beside the name. It is now a sibling of the plate and a direct child of
the card, which is what makes "full-bleed along the foot" mean anything.

### 20. `1fr` will not shrink below its own content - **fixed**

The corner's mark row was `1fr`. An `fr` track has an *automatic* minimum, which
for an SVG is its intrinsic height - so when the corner shrank from 51px to 45px
at a 320px phone, the row could not give way, the three rows overran the tile,
and `align-content: center` pushed the mark out of **both** ends. `minmax(0, 1fr)`
lets the track shrink, which is what lets the mark's `max-height: 100%` actually
scale it down rather than merely describe it. Caught at 320px only; it passed at
every larger size.

### 21. An auto track sized itself to the longest title - **fixed**

The title is one unbroken line. In a grid whose column was left to its own
sizing, MOUNT KAILASH grew the column **3.2px wider than the card** and pushed
the band off the edge. `grid-template-columns: minmax(0, 1fr)` is the track that
says *exactly this wide, whatever you would like to be*.

### 22. A string replacement that matched nothing, reported as success - **fixed**

The Atlantis arcade is generated twice, once filled and once outlined. Its
opacity was being set by rewriting the generated markup with
`.replace(/opacity="[^"]*"/g, ...)`, over paths that had no opacity attribute -
so the fill rendered at **full ink** and the card came out as a dark slab.
`String.replace` on a miss is a no-op that returns the original string, so this
failed silently. The fill is now set as each path is written.

---

## What still needs a human eye

- **The six spaces have been seen only as stills.** Nobody has touched the phone.
- **Ragnarok's upper blade still reads slightly like a banner.** The break, the
  swept-down guard and the dissolving pommel together say *sword* at a glance, but
  the trapezium above the break is the one shape on the card that is not obviously
  a weapon. It is the weakest of the six and the one most worth another pass.
- **Halley's tail has a straight lower edge** running from the head out to about
  two-thirds along. It is the one stroke in the set that does not bow, and it is
  what makes the tail read as a swoosh rather than as dust.
- **Dwarka's dome is a plain bulb** - it has no cornice ring under it and no
  vertical rib, which are the two details that would stop it looking like an
  onion. The columns, plinth, spires and far ridge all work; the dome is the
  weak part.
- **The other twenty-two spaces are still blank marks.** The next run should
  establish whether these six are a repeatable system or a one-off, and that
  question is only answerable once there is a second run to compare against.
*Made by Samraj.*