// The animation editor's "Ask Claude" (dev server only; vite.config.ts `rigEdit`): Mark says what's
// wrong with a pose in his own words, and Claude Code, run headless on his own plan, looks at the
// pose and answers with a changed one, which the editor shows as an undoable edit.
//
// Claude runs with no tools, no MCP servers, no skills and its own short system prompt, from an
// empty folder (so no project instructions load): it can only look at what's sent and answer in
// the JSON shape below. That keeps a call to a few thousand tokens (a default headless session
// loads the whole setup, over 300,000) and means it can't touch any file.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYSTEM = `You help Mark, a designer who is new to pixel art and animation, pose the characters of Shadow Jog, a pixel-art JRPG in the style of Phantasy Star IV. Party members are seen from behind in battle, at the bottom of the screen, facing enemies above them (further into the screen, so "toward the enemy" is up the picture).

A character's arm is a skeleton of fixed-length bones: shoulder to elbow to wrist, then the hand (and anything it holds). A pose says where the wrist should go; the elbow is worked out automatically (two-bone IK), so the arm can never stretch, and a target out of reach leaves the arm straight, pointing at it. You change poses only through the fields of the answer; you can't redraw pixels.

Coordinates: a 128x128 canvas, x to the right, y DOWN (smaller y is higher). Angles in degrees, 0 = pointing right, 90 = pointing down, -90 = pointing up; positive turns clockwise on screen.

Answer with the structured output: the whole changed pose, and "say": one to three plain sentences for Mark about what you changed and why, in everyday words (no jargon). If what he asks can't be done by changing the pose (the arm's length or joints are wrong, pixels are missing), leave the pose as it is and say what would have to change instead.`;

/** The answer's shape: the pose fields the game knows (src/art/rig2/battle.ts ArmPose), and a message. */
const SCHEMA = {
  type: 'object',
  properties: {
    pose: {
      type: 'object',
      properties: {
        hand: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Where the wrist goes, [x, y]' },
        flip: { type: 'boolean', description: 'The elbow bends the other way from its rest pose' },
        grip: { type: 'number', description: 'The hand (and what it holds) turned at the wrist, degrees, > 0 clockwise' },
        weapon: { type: 'object', properties: { kind: { type: 'string', enum: ['katana', 'pistol'] }, angle: { type: 'number', description: 'From the forearm, degrees' } }, required: ['kind', 'angle'] },
        light: { type: 'string', enum: ['spark', 'impact', 'shot'] },
        lightAt: { type: 'string', enum: ['hand', 'tip', 'top'] },
        lean: { type: 'number', description: 'The whole body tipped about the feet, degrees, > 0 clockwise (-12 to 12)' },
        drop: { type: 'number', description: 'The whole body lowered, pixels (0 to 8)' },
        behind: { type: 'boolean', description: 'The arm drawn behind the body' },
        shape: { type: 'string', enum: ['fist', 'open'], description: 'The hand: a fist, or open with the fingers out (only if the character has an open hand)' },
      },
      required: ['hand'],
    },
    say: { type: 'string' },
  },
  required: ['pose', 'say'],
};

/**
 * Ask Claude to change a pose. `images` are PNG data URLs: `now` (the pose, 4x, with a grid every 8
 * pixels and the joints marked) and maybe `before` (the pose the move comes from). Resolves with
 * `{ pose, say }`; rejects with a message for Mark.
 */
export function askClaude({ who, poseName, poseHelp, note, pose, arm, joints, images, model }) {
  const dir = join(tmpdir(), 'shadowjog-rig-ask');
  mkdirSync(dir, { recursive: true });
  const text = [
    `Character: ${who}. Pose: "${poseName}" (${poseHelp}).`,
    `The arm at rest: shoulder ${JSON.stringify(arm.shoulder)}, elbow ${JSON.stringify(arm.elbow)}, wrist ${JSON.stringify(arm.wrist)}. Bone lengths: upper arm ${joints.upper.toFixed(1)}, forearm ${joints.fore.toFixed(1)} (the wrist reaches at most ${(joints.upper + joints.fore).toFixed(1)} px from the shoulder).`,
    `In the pose now: shoulder ${fmt(joints.shoulder)}, elbow ${fmt(joints.elbow)}, wrist ${fmt(joints.wrist)}, hand's far end ${fmt(joints.tip)}.`,
    `The pose's data now: ${JSON.stringify(pose)}`,
    `Image 1 is the pose now at 4x (one grid square = 8 canvas pixels; labels are canvas coordinates; the orange dot is the wrist, blue the elbow, grey the shoulder).${images.before ? ' Image 2 is the pose this move starts from, the same way.' : ''}`,
    `Mark's note: ${note}`,
  ].join('\n\n');
  const content = [];
  for (const url of [images.now, images.before]) if (url) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: url.split(',')[1] } });
  content.push({ type: 'text', text });
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(SCHEMA), '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--model', model === 'opus' ? 'opus' : 'sonnet', '--system-prompt', SYSTEM];
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude took longer than three minutes, so it was stopped. Try again, or try the quick model.'));
    }, 180_000);
    child.stdout.on('data', (d) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      err += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't start Claude Code (${e.message}). Is the claude command installed and signed in?`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      const result = out
        .split('\n')
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .find((e) => e?.type === 'result');
      if (!result) return reject(new Error(`Claude didn't answer${err ? `: ${err.trim().slice(0, 300)}` : '.'}`));
      if (result.is_error || !result.structured_output) return reject(new Error(`Claude couldn't do it: ${String(result.result ?? 'no answer').slice(0, 300)}`));
      resolve(result.structured_output);
    });
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
  });
}

const fmt = (p) => `[${p.map((v) => Math.round(v)).join(', ')}]`;
