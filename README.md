# Sakana Fugu connector for pi

Registers Sakana Fugu as a pi model provider via `pi.registerProvider()`.

## Install

```bash
pi install git:github.com/SzymonMielecki/pi-extension-sakana-fugu
```

Restart pi or run `/reload` after installing.

## Authenticate

Preferred: use pi's login flow:

```text
/login sakana
```

The connector opens the Sakana API keys page, prompts for your key, validates it with `/v1/models`, then stores it in pi's auth store.

Environment variables also work:

```bash
export SAKANA_API_KEY="sk-..."
# Optional aliases/overrides, read at pi startup:
# export FUGU_API_KEY="sk-..."        # accepted when SAKANA_API_KEY is unset
# export SAKANA_BASE_URL="https://api.sakana.ai/v1"
# export FUGU_BASE_URL="https://api.sakana.ai/v1"
```

## Models

Select one of these with `/model`:

- `sakana/fugu`
- `sakana/fugu-ultra`
- `sakana/fugu-ultra-20260615`

## Notes

- Uses Sakana's OpenAI-compatible **Responses API** at `https://api.sakana.ai/v1`.
- Reasoning levels exposed to pi are `high` and `xhigh`; lower/off levels are hidden because Fugu only accepts `high`, `xhigh`, or `max`.
- `fugu` has dynamic routing/pricing, so its static pi cost is set to zero rather than an inaccurate fixed rate.
- `fugu-ultra` uses Sakana's base public rate per 1M tokens: `$5` input, `$30` output, `$0.50` cached input. Sakana may charge a higher tier for context above 272K, which pi's static cost fields cannot represent.
