import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GENERATION_PROMPT } from '../src/lib/generation-prompt'
import { validateSiteConfig } from '../src/lib/generate-site'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-3-flash-preview'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' })
  }

  const { prompt } = req.body
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `Generate a website configuration for: ${prompt}` }],
            },
          ],
          systemInstruction: {
            parts: [{ text: GENERATION_PROMPT }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.8,
          },
        }),
      }
    )

    clearTimeout(timeout)

    if (!response.ok) {
      if (response.status === 429) return res.status(429).json({ error: 'AI generation is temporarily rate limited' })
      return res.status(502).json({ error: 'AI generation service failed' })
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
      return res.status(502).json({ error: 'Empty response from Gemini' })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return res.status(502).json({ error: 'AI returned malformed JSON' })
    }

    try {
      return res.status(200).json(validateSiteConfig(parsed, prompt))
    } catch {
      return res.status(502).json({ error: 'AI returned an invalid website configuration' })
    }
  } catch (err: unknown) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      return res.status(504).json({ error: 'Generation timed out after 30 seconds' })
    }
    return res.status(500).json({ error: 'Generation failed', details: String(err) })
  }
}
