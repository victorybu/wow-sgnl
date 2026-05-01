import { anthropic } from './anthropic';
import { composeVoiceBlock, VoiceExample, AntiVoiceExample } from './voice';

export async function generateAngles(args: {
  event: string;
  clientName: string;
  voiceProfile: string;
  voiceExamples?: VoiceExample[];
  antiExamples?: AntiVoiceExample[];
}): Promise<string[]> {
  const sys = `You are a senior digital strategist. Given an event, propose 3 distinct strategic angles a client could take in response. Each angle is one short sentence describing the *positioning*, not a draft post.

Output JSON only: {"angles": ["...", "...", "..."]}

Be sharp and contrarian. No generic angles like "show empathy" or "offer thought leadership."`;

  const voiceBlock = composeVoiceBlock(
    args.voiceProfile || '',
    args.voiceExamples || [],
    args.antiExamples || [],
  );

  const user = `Client: ${args.clientName}

${voiceBlock}

Event: ${args.event}

Give 3 angles.`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean).angles || [];
  } catch {
    return [];
  }
}

export async function generatePosts(args: {
  event: string;
  angle: string;
  clientName: string;
  voiceProfile: string;
  voiceExamples?: VoiceExample[];
  antiExamples?: AntiVoiceExample[];
  platform: 'x' | 'thread' | 'reply';
}): Promise<string[]> {
  const platformGuide = {
    x: 'Single tweet, under 280 chars, punchy, no hashtags, no emojis unless the voice profile uses them.',
    thread: 'Opening tweet of a thread (under 280 chars) plus 3-5 follow-up tweets. Format as numbered list.',
    reply: 'A quote-post or reply that recontextualizes the original. Under 280 chars.',
  }[args.platform];

  const sys = `You write platform-native posts in a specific voice. Match the voice exactly — cadence, vocabulary, punctuation habits, capitalization. Do not invent facts. Do not use consulting language.

Output JSON only: {"posts": ["...", "...", "..."]}

Generate 3 distinct variants.`;

  const voiceBlock = composeVoiceBlock(
    args.voiceProfile || '',
    args.voiceExamples || [],
    args.antiExamples || [],
  );

  const user = `Client: ${args.clientName}

${voiceBlock}

Event: ${args.event}
Angle: ${args.angle}
Platform: ${args.platform} — ${platformGuide}

Write 3 variants.`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean).posts || [];
  } catch {
    return [];
  }
}
