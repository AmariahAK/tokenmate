# Security Policy

## Supported versions

tokenmate is in early development. Only the latest code on `main` and the latest release receive security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately, either by email to [support@atlarix.dev](mailto:support@atlarix.dev) or through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and its impact
- steps to reproduce, or a proof of concept
- the tokenmate version or commit, your OS and your Bun version

You should get an acknowledgement within 7 days. We'll keep you updated while we work on a fix and credit you in the release notes unless you'd rather stay anonymous.

## How tokenmate handles API keys

tokenmate is bring-your-own-key. As AI features land, these rules apply:

- Keys are read from environment variables or stored in a local config file under your user config directory, created with owner-only permissions. They are never written to the repository, logs, saved games or crash output.
- Keys are only sent to the provider they belong to. tokenmate has no server of its own and does not collect telemetry.
- The models.dev catalogue is fetched anonymously. No keys are sent with that request.
- Custom provider base URLs are used exactly as you enter them. Only add endpoints you trust.

If you find a path where a key could leak (logs, error messages, exported files, network requests to the wrong host), please report it using the process above.
