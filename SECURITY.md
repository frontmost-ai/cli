# Security

Report a security problem in private: open the **Security** tab of this repository and select **Report a vulnerability**.
Do not open a public issue for it.

## How the CLI handles your API key

- It sends the key only to `https://app.frontmost.ai`, as a Bearer header. It does not follow redirects.
- `frontmost login` saves the key in `~/.config/frontmost/config.json`. Only your user can read that file.
- It never prints the key.
- It has no runtime dependencies. The code in `src` is the code that runs.
