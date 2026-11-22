/** Fixed simulation rate. */
export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
/** Run speed in world units (cm) per second. */
export const RUN_SPEED = 540;
/**
 * Live player (clutcher) run speed (cm/s), ~15% above RUN_SPEED so dodging feels responsive.
 * Bots and the replay rails (PRO) keep RUN_SPEED.
 */
export const PLAYER_RUN_SPEED = 620;
/** Navmesh cell size (cm). */
export const NAV_CELL = 100;
/** Agent clearance from walls (cm). Must be >= NAV_CELL * (sqrt(2)/2 + 1/16) so walkable cells never overlap walls. */
export const NAV_CLEARANCE = 90;

// --- Player (clutcher) combat ---
/** Seconds between player shots. */
export const PLAYER_FIRE_S = 0.3;
export const PLAYER_DAMAGE = 25;
/** Max hitscan range (cm). */
export const PLAYER_RANGE = 8000;
/** Enemy hitbox radius for the player's hitscan (cm). */
export const ENEMY_HIT_RADIUS = 90;
/** Spread half-width (radians, small-angle) when standing still / moving. */
export const SPREAD_STILL = 0.03;
export const SPREAD_MOVING = 0.08;

// --- Bots ---
export const VIEW_RANGE = 4500;
/** cos(60°): bots notice inside a 120° cone around their facing. */
export const FOV_COS = 0.5;
/** Bots notice anything this close with line of sight, regardless of facing. */
export const NEAR_NOTICE = 700;
/** Bots notice a shooting player within this range with line of sight, regardless of facing. */
export const HEAR_RANGE = 2500;
export const REACTION_MIN_S = 0.25;
export const REACTION_MAX_S = 0.4;
export const BOT_FIRE_S = 0.5;
export const BOT_DAMAGE = 30;
export const BOT_HIT_MAX = 0.5;
export const BOT_HIT_MIN = 0.15;
/** Hit chance multiplier while the player is moving. */
export const BOT_MOVING_TARGET = 0.7;
/**
 * Crowd damping: when more than this many bots are engaged at once, each one's hit chance is
 * scaled by BOT_CROWD_BUDGET / engaged, so a 1v4 crossfire stays survivable for a skilled player.
 */
export const BOT_CROWD_BUDGET = 2;
/** Give up hunting after this long and return to the rail. */
export const HUNT_MAX_S = 4;
/** Enemies start with at least this much HP (data HP is often chip-damaged; keeps duels fair). */
export const ENEMY_MIN_HP = 100;
/**
 * Design decision: bots hold fire for this long after the round starts (after the 3-2-1
 * countdown) so a new player can feel the controls before taking damage. They still notice,
 * turn and run their reaction delay during the grace period.
 */
export const BOT_GRACE_S = 1;
/** Retake margin: defenders head for a planted spike when the timer gets this close (plus travel + defuse). */
export const RETAKE_MARGIN_S = 2;

// --- Spike ---
export const DEFUSE_S = 5;
export const DEFUSE_RADIUS = 200;
/** Spike timer for plants that happen after t = 0. */
export const SPIKE_TIMER_S = 45;
