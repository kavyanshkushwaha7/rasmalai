import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { OnlineGameBoards } from "../components/games/OnlineGameBoards.js";
import { createLudoGame, moveLudoToken } from "../lib/games/ludo.js";
import type { LudoState } from "../lib/games/ludo.js";
import { createSnakesAndLaddersGame, getSnakesBoardCell, rollSnakesAndLadders } from "../lib/games/snakes-and-ladders.js";
import { getLudoCaptureReturnPoints, getLudoGridPoint, getLudoProgressCell, getLudoYardPoint } from "../lib/games/ludo-token-motion.js";
import { getValidatedOnlineMoveAnimation } from "../lib/games/online-move-animation.js";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const names = ["Player A", "Player B"];
const roomPlayers = names.map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));

function withDom<T>(run: (dom: Window) => Promise<T>) {
  const dom = new Window({ url: "http://localhost" });
  const names = ["window", "document", "navigator", "HTMLElement", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const original = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: dom },
    document: { configurable: true, writable: true, value: dom.document },
    navigator: { configurable: true, writable: true, value: dom.navigator },
    HTMLElement: { configurable: true, writable: true, value: dom.HTMLElement },
    MutationObserver: { configurable: true, writable: true, value: dom.MutationObserver },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });
  return run(dom).finally(() => {
    dom.happyDOM.abort();
    dom.close();
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  });
}

function snapshots(game: "LUDO" | "SNAKES_AND_LADDERS", die: 2 | 6) {
  if (game === "SNAKES_AND_LADDERS") {
    const initial = createSnakesAndLaddersGame(names);
    const beforeState = { ...initial, players: initial.players.map((player, index) => index === 0 ? { ...player, position: 10 } : player) };
    const afterState = rollSnakesAndLadders(beforeState, die);
    const previous: OnlineRoomSnapshot = { roomId: `room-snakes-${die}`, roomCode: "TEST", gameType: game, visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 2, matchId: `match-snakes-${die}`, version: 10, state: beforeState, players: roomPlayers };
    const next = { ...previous, version: 11, state: afterState };
    return { previous, next, event: getValidatedOnlineMoveAnimation(previous, next) };
  }
  const initial = createLudoGame(names);
  const beforeState = { ...initial, pendingRoll: die, players: initial.players.map((player, index) => index === 0 ? { ...player, tokens: [5, 7, 15, 30] } : player) };
  const afterState = moveLudoToken(beforeState, 0);
  const previous: OnlineRoomSnapshot = { roomId: `room-ludo-${die}`, roomCode: "TEST", gameType: game, visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 2, matchId: `match-ludo-${die}`, version: 10, state: beforeState, players: roomPlayers };
  const next = { ...previous, version: 11, state: afterState };
  return { previous, next, event: getValidatedOnlineMoveAnimation(previous, next) };
}

async function verifyRenderedSequence(game: "LUDO" | "SNAKES_AND_LADDERS", die: 2 | 6) {
  const { next, event } = snapshots(game, die);
  assert.ok(event, `the engine transition should validate for ${game} die ${die}`);
  await withDom(async (dom) => {
    Object.defineProperty(dom, "matchMedia", { configurable: true, value: () => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
    const rafQueue: Array<(time: number) => void> = [];
    Object.defineProperty(dom, "requestAnimationFrame", { configurable: true, value: (callback: (time: number) => void) => { rafQueue.push(callback); return rafQueue.length; } });
    Object.defineProperty(dom, "cancelAnimationFrame", { configurable: true, value: () => {} });
    const rootElement = dom.document.createElement("div");
    dom.document.body.append(rootElement);
    const root = createRoot(rootElement as unknown as Element);
    const acknowledgeA = () => {};
    const acknowledgeB = () => {};
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(OnlineGameBoards, { room: next, userId: "user-0", onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: acknowledgeA }),
        createElement(OnlineGameBoards, { room: next, userId: "user-1", onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: acknowledgeB }),
      ));
    });

    const selector = game === "LUDO" ? ".ludo-moving-coin" : ".snakes-moving-token";
    const queryElements = (query: string) => Array.from(rootElement.querySelectorAll(query)).map((element) => element as unknown as HTMLElement);
    const renderedViews = queryElements(selector);
    assert.equal(renderedViews.length, 2, "the actor and opponent each render a moving coin");
    let startPosition: string;
    let expectedStepCoordinates: string[];
    if (event.gameType === "SNAKES_AND_LADDERS") {
      const positionFor = (square: number) => {
        const cell = getSnakesBoardCell(square);
        return { left: (cell.col + .5) * 10, top: (cell.row + .5) * 10 };
      };
      const start = positionFor(event.from);
      startPosition = `${start.left.toFixed(3)}%:${start.top.toFixed(3)}%`;
      expectedStepCoordinates = event.steps.map((square) => {
        const point = positionFor(square);
        return `${square}:${point.left.toFixed(3)}:${point.top.toFixed(3)}`;
      });
    } else {
      const ludoState = next.state as LudoState;
      const player = ludoState.players[event.playerIndex];
      const start = getLudoGridPoint(getLudoProgressCell(player, event.fromProgress));
      startPosition = `${start.left.toFixed(3)}%:${start.top.toFixed(3)}%`;
      expectedStepCoordinates = event.steps.map((step) => {
        const point = getLudoGridPoint(step.cell);
        return `${step.progress}:${point.left.toFixed(3)}:${point.top.toFixed(3)}`;
      });
    }
    assert.deepEqual(renderedViews.map((view) => `${Number.parseFloat(view.style.left).toFixed(3)}%:${Number.parseFloat(view.style.top).toFixed(3)}%`), [startPosition, startPosition], "both client views start at the coin's committed previous square");
    assert.equal(rafQueue.length, 2, "each client waits one frame before its first hop");
    await act(async () => { for (const callback of rafQueue.splice(0)) callback(0); });
    const observedCoordinates: Set<string>[] = renderedViews.map(() => new Set<string>());
    const landingCueIds: Set<string>[] = renderedViews.map(() => new Set<string>());
    const deadline = Date.now() + die * 500 + 1800;
    while (Date.now() < deadline && landingCueIds.some((set) => set.size < die)) {
      await act(async () => { await wait(20); });
      const currentViews = queryElements(selector);
      currentViews.forEach((view, index) => {
        const step = game === "LUDO" ? view.dataset.motionProgress : view.dataset.motionSquare;
        const left = Number.parseFloat(view.style.left);
        const top = Number.parseFloat(view.style.top);
        if (step && Number.isFinite(left) && Number.isFinite(top)) observedCoordinates[index].add(`${step}:${left.toFixed(3)}:${top.toFixed(3)}`);
        for (const burst of queryElements("[data-landing-event]")) {
          if (burst.dataset.landingEvent?.startsWith(event.id)) landingCueIds[index].add(burst.dataset.landingEvent);
        }
      });
    }
    await act(async () => { await wait(120); });

    for (let viewIndex = 0; viewIndex < 2; viewIndex += 1) {
      assert.equal(observedCoordinates[viewIndex].size, die, `${game} view ${viewIndex} must render a distinct coordinate for every die step`);
      assert.deepEqual([...observedCoordinates[viewIndex]].sort(), [...expectedStepCoordinates].sort(), `${game} view ${viewIndex} renders the exact intermediate square coordinates`);
      const actualLandingIds: string[] = [...landingCueIds[viewIndex]].map((key: string): string => key.slice(event.id.length + 1));
      const expectedLandingIds: string[] = Array.from({ length: die }, (_unused: unknown, index: number): string => `landing:${index}`);
      assert.deepEqual(actualLandingIds.sort(), expectedLandingIds.sort(), `${game} view ${viewIndex} emits one visible landing burst per square`);
    }

    await act(async () => { root.unmount(); });
    rootElement.remove();
  });
}

test("Snakes & Ladders waits for every die-square position before its server-validated snake slide", async () => {
  const initial = createSnakesAndLaddersGame(names);
  const beforeState = { ...initial, players: initial.players.map((player, index) => index === 0 ? { ...player, position: 23 } : player) };
  const afterState = rollSnakesAndLadders(beforeState, 6);
  const previous: OnlineRoomSnapshot = { roomId: "room-snake-slide", roomCode: "SLIDE", gameType: "SNAKES_AND_LADDERS", visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 2, matchId: "match-snake-slide", version: 30, state: beforeState, players: roomPlayers };
  const next = { ...previous, version: 31, state: afterState };
  const event = getValidatedOnlineMoveAnimation(previous, next);
  assert.ok(event?.gameType === "SNAKES_AND_LADDERS" && event.transport === "snake");
  await withDom(async (dom) => {
    Object.defineProperty(dom, "matchMedia", { configurable: true, value: () => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
    const element = dom.document.createElement("div");
    dom.document.body.append(element);
    const root = createRoot(element as unknown as Element);
    await act(async () => { root.render(createElement(OnlineGameBoards, { room: next, userId: "user-0", onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: () => {} })); });
    const visited = new Set<string>();
    let transportStartedAfterAllSteps = false;
    let transportReachedTail = false;
    const deadline = Date.now() + 6 * 500 + 2400;
    while (Date.now() < deadline && !transportReachedTail) {
      await act(async () => { await wait(20); });
      const token = element.querySelector(".snakes-moving-token") as unknown as HTMLElement | null;
      if (!token) continue;
      if (token.dataset.motionPhase === "transport") {
        transportStartedAfterAllSteps = [24, 25, 26, 27, 28, 29].every((square) => visited.has(String(square)));
        const routeIndex = Number(token.dataset.motionRouteStep);
        const expectedRoutePoint: { x: number; y: number } | undefined = event.transportPoints[routeIndex];
        assert.ok(expectedRoutePoint, "the coin has a point on the shared snake path");
        assert.equal(Number.parseFloat(token.style.left), Number((expectedRoutePoint.x / 10).toFixed(4)), "the rendered coin position follows the shared drawn snake route");
        assert.equal(Number.parseFloat(token.style.top), Number((expectedRoutePoint.y / 10).toFixed(4)));
        transportReachedTail = routeIndex === event.transportPoints.length - 1 && token.dataset.motionSquare === "9";
      } else if (token.dataset.motionStep !== "0" && token.dataset.motionSquare) visited.add(token.dataset.motionSquare);
    }
    assert.deepEqual([...visited], ["24", "25", "26", "27", "28", "29"]);
    assert.equal(transportStartedAfterAllSteps, true);
    assert.equal(transportReachedTail, true, "the animated coin finishes at the engine's validated snake tail");
    await act(async () => { root.unmount(); });
    element.remove();
  });
});

test("hydrating a final room after refresh shows its current coin without replaying an old event", async () => {
  const snakes = snapshots("SNAKES_AND_LADDERS", 6).next;
  const ludo = snapshots("LUDO", 6).next;
  await withDom(async (dom) => {
    const element = dom.document.createElement("div");
    dom.document.body.append(element);
    const root = createRoot(element as unknown as Element);
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(OnlineGameBoards, { room: snakes, userId: "user-0", onAction: () => {}, moveAnimations: [] }),
        createElement(OnlineGameBoards, { room: ludo, userId: "user-0", onAction: () => {}, moveAnimations: [] }),
      ));
    });
    assert.equal(element.querySelectorAll(".coin-motion-token").length, 0);
    assert.ok(element.querySelector(".snakes-static-token"));
    assert.ok(element.querySelector(".ludo-token"));
    await act(async () => { root.unmount(); });
    element.remove();
  });
});

test("an online Ludo roll button dispatches once for the connected active seat and ignores locked taps", async () => {
  await withDom(async (dom) => {
    const players = ["A", "B", "C", "D"].map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
    const room: OnlineRoomSnapshot = {
      roomId: "roll-click-room", roomCode: "CLIK", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS",
      creatorId: "user-0", maxPlayers: 4, matchId: "roll-click-match", version: 0, state: createLudoGame(players.map((entry) => entry.name)), players,
    };
    const rootElement = dom.document.createElement("div");
    dom.document.body.append(rootElement);
    const root = createRoot(rootElement as unknown as Element);
    const actions: Array<{ type: string }> = [];
    await act(async () => { root.render(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: (action) => actions.push(action) })); });
    const rollButton = rootElement.querySelector(".ludo-roll-button") as unknown as HTMLButtonElement;
    assert.equal(rollButton.disabled, false);
    await act(async () => { rollButton.click(); });
    assert.deepEqual(actions, [{ type: "roll" }], "a touch-compatible click reaches the current player's roll handler");

    await act(async () => { root.render(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: (action) => actions.push(action), actionBusy: true, pendingActionType: "roll", diceRollAnimationId: "pending-roll" })); });
    const lockedButton = rootElement.querySelector(".ludo-roll-button") as unknown as HTMLButtonElement;
    assert.equal(lockedButton.disabled, true, "the pending acknowledgement state blocks a second tap");
    await act(async () => { lockedButton.click(); });
    assert.deepEqual(actions, [{ type: "roll" }], "a double-tap cannot dispatch another roll while a request is pending");
    await act(async () => { root.unmount(); });
    rootElement.remove();
  });
});

test("reduced-motion preference completes queued moves without playing a hop sequence", async () => {
  const snakes = snapshots("SNAKES_AND_LADDERS", 6);
  const ludo = snapshots("LUDO", 6);
  await withDom(async (dom) => {
    Object.defineProperty(dom, "matchMedia", { configurable: true, value: () => ({ matches: true, media: "(prefers-reduced-motion: reduce)", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
    const element = dom.document.createElement("div");
    dom.document.body.append(element);
    const root = createRoot(element as unknown as Element);
    let completed = 0;
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(OnlineGameBoards, { room: snakes.next, userId: "user-0", onAction: () => {}, moveAnimations: [snakes.event!], onMoveAnimationComplete: () => { completed += 1; } }),
        createElement(OnlineGameBoards, { room: ludo.next, userId: "user-0", onAction: () => {}, moveAnimations: [ludo.event!], onMoveAnimationComplete: () => { completed += 1; } }),
      ));
    });
    assert.equal(element.querySelectorAll(".coin-motion-token").length, 0);
    assert.equal(completed, 2, "each server event completes once without animating under reduced motion");
    await act(async () => { root.unmount(); });
    element.remove();
  });
});

test("validated Ludo capture moves the captured coin from its track square into its own yard on both clients", async () => {
  const captureNames = ["Yellow", "Blue", "Red", "Green"];
  const players = captureNames.map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
  const initial = createLudoGame(captureNames);
  const beforeState = {
    ...initial,
    pendingRoll: 1,
    players: initial.players.map((player, index) => index === 0
      ? { ...player, tokens: [26, -1, -1, -1] }
      : index === 2 ? { ...player, tokens: [1, -1, -1, -1] } : player),
  };
  const afterState = moveLudoToken(beforeState, 0);
  const previous: OnlineRoomSnapshot = { roomId: "capture-room", roomCode: "KNOCK", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 4, matchId: "capture-match", version: 10, state: beforeState, players };
  const next: OnlineRoomSnapshot = { ...previous, version: 11, state: afterState };
  const event = getValidatedOnlineMoveAnimation(previous, next);
  assert.ok(event?.gameType === "LUDO");
  assert.deepEqual(event.captures, [{ playerIndex: 2, tokenIndex: 0, fromProgress: 1 }]);
  await withDom(async (dom) => {
    Object.defineProperty(dom, "matchMedia", { configurable: true, value: () => ({ matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
    const element = dom.document.createElement("div");
    dom.document.body.append(element);
    const root = createRoot(element as unknown as Element);
    await act(async () => { root.render(createElement(Fragment, null,
      createElement(OnlineGameBoards, { room: next, userId: "user-0", onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: () => {} }),
      createElement(OnlineGameBoards, { room: next, userId: "user-3", onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: () => {} }),
    )); });
    const from = getLudoGridPoint(getLudoProgressCell(beforeState.players[2], 1));
    const to = getLudoYardPoint(afterState.players[2], 0);
    const route = getLudoCaptureReturnPoints(from, to);
    const seen = [new Set<number>(), new Set<number>()];
    const impacts = [false, false];
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline && seen.some((steps) => !steps.has(route.length - 1))) {
      await act(async () => { await wait(20); });
      const tokens = Array.from(element.querySelectorAll(".ludo-moving-coin")) as unknown as HTMLElement[];
      tokens.forEach((token, view) => {
        if (token.dataset.motionPhase !== "capture") return;
        assert.equal(token.dataset.motionPlayer, "2", "the captured red player's identity remains on the returning coin");
        assert.equal(token.dataset.motionToken, "0");
        const routeStep = Number(token.dataset.motionRouteStep);
        if (Number.isInteger(routeStep)) seen[view].add(routeStep);
        impacts[view] ||= !!element.querySelector(`[data-landing-event^="${event.id}:capture:2:0:impact"]`);
      });
    }
    for (let view = 0; view < 2; view += 1) {
      assert.ok(seen[view].size >= 10, `client ${view} renders successive captured-coin return waypoints`);
      assert.ok(seen[view].has(route.length - 1), `client ${view} reaches its captured token's yard`);
      assert.equal(impacts[view], true, `client ${view} shows the capture impact burst`);
    }
    await act(async () => { root.unmount(); });
    element.remove();
  });
});

for (const game of ["SNAKES_AND_LADDERS", "LUDO"] as const) {
  test(`${game} actor and opponent DOM positions visit every square for dice 2`, async () => verifyRenderedSequence(game, 2));
  test(`${game} actor and opponent DOM positions visit every square for dice 6`, async () => verifyRenderedSequence(game, 6));
}
