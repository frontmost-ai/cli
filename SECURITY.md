# Security

Report a security problem in private: open the **Security** tab of this repository and select **Report a vulnerability**.
Do not open a public issue for it.

## How the CLI handles your sign-in

- `frontmost login` signs you in with your browser. The CLI never sees your password.
- The sign-in uses OAuth 2.0 with PKCE. The browser comes back to `127.0.0.1` on your computer, and the CLI accepts only the reply to the sign-in that it started.
- `app.frontmost.ai` names the sign-in server. The CLI talks to that server only over https.
- The CLI saves the sign-in in `~/.config/frontmost/config.json`. Only your user can read that file.
- Access lasts 5 minutes. The CLI renews it while you stay signed in.
- `frontmost logout` removes the file. After that, no copy of the sign-in is left on your computer.

## How the CLI handles your API key

- It sends the key only to `https://app.frontmost.ai`, as a Bearer header. It does not follow redirects.
- `frontmost login --with-key` saves the key in the same file as above.

## Both

- The CLI never prints a key or a sign-in.
- It has no runtime dependencies. The code in `src` is the code that runs.
