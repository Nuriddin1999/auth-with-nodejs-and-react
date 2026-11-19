/** OpenAPI 3 schema for /api/schema/ and the Swagger UI page for /api/docs/. */

type Props = Record<string, { type: string; format?: string; description?: string; enum?: string[] }>;

const str = { type: 'string' };
const emailProp = { type: 'string', format: 'email' };
const object = (properties: Props, required = Object.keys(properties)) => ({
  'application/json': { schema: { type: 'object', properties, required } },
});

interface Operation {
  summary: string;
  body?: ReturnType<typeof object>;
  auth?: 'optional' | 'required';
}

function op({ summary, body, auth }: Operation) {
  return {
    summary,
    tags: ['auth'],
    ...(body ? { requestBody: { content: body, required: true } } : {}),
    ...(auth === 'required' ? { security: [{ jwtAuth: [] }] } : auth === 'optional' ? { security: [{ jwtAuth: [] }, {}] } : { security: [] }),
    responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
  };
}

const paths: Record<string, Record<string, ReturnType<typeof op>>> = {
  '/api/auth/providers/': { get: op({ summary: 'Public config for the login buttons' }) },
  '/api/auth/google/': {
    post: op({ summary: 'Sign in with a Google ID token', body: object({ credential: { type: 'string', description: 'Google ID token (JWT)' } }), auth: 'optional' }),
  },
  '/api/auth/facebook/': {
    post: op({ summary: 'Sign in with a Facebook access token', body: object({ access_token: str }), auth: 'optional' }),
  },
  '/api/auth/telegram/': {
    post: op({
      summary: 'Sign in with Telegram Login Widget data',
      body: object(
        { id: { type: 'integer' }, first_name: str, last_name: str, username: str, photo_url: str, auth_date: { type: 'integer' }, hash: str },
        ['id', 'auth_date', 'hash'],
      ),
      auth: 'optional',
    }),
  },
  '/api/auth/telegram/login/start/': { post: op({ summary: 'Start a sign-in with a code from the Telegram bot' }) },
  '/api/auth/telegram/login/status/': { post: op({ summary: 'Poll the Telegram sign-in page session', body: object({ token: str }) }) },
  '/api/auth/telegram/login/verify/': {
    post: op({ summary: 'Sign in with the code from the Telegram bot', body: object({ token: str, code: str }), auth: 'optional' }),
  },
  '/api/auth/telegram/webhook/': { post: op({ summary: 'Telegram bot webhook (production)' }) },
  '/api/auth/login/': { post: op({ summary: 'Sign in with email + password', body: object({ email: emailProp, password: str }) }) },
  '/api/auth/email/signup/': {
    post: op({ summary: 'Sign up, step 1: send a code to the email', body: object({ name: str, email: emailProp, password: str, password_confirm: str }) }),
  },
  '/api/auth/email/verify/': { post: op({ summary: 'Sign up, step 2: confirm the code', body: object({ email: emailProp, code: str }) }) },
  '/api/auth/email/resend/': {
    post: op({ summary: 'Send a new code', body: object({ email: emailProp, purpose: { type: 'string', enum: ['signup', 'reset'] } }) }),
  },
  '/api/auth/password/reset/': { post: op({ summary: 'Forgot password, step 1: send a code', body: object({ email: emailProp }) }) },
  '/api/auth/password/reset/verify/': {
    post: op({ summary: 'Forgot password, step 2: code -> reset token', body: object({ email: emailProp, code: str }) }),
  },
  '/api/auth/password/reset/confirm/': {
    post: op({ summary: 'Forgot password, step 3: set the new password', body: object({ token: str, password: str, password_confirm: str }) }),
  },
  '/api/auth/token/refresh/': { post: op({ summary: 'New access token from the refresh cookie' }) },
  '/api/auth/logout/': { post: op({ summary: 'Sign out (revokes the refresh cookie)' }) },
  '/api/auth/me/': {
    get: op({ summary: 'The current user', auth: 'required' }),
    patch: op({ summary: 'Update the current user', body: object({ username: str, first_name: str, last_name: str }, []), auth: 'required' }),
  },
  '/api/auth/social/{provider}/': { delete: op({ summary: 'Unlink a provider', auth: 'required' }) },
};

export const schema = {
  openapi: '3.0.3',
  info: { title: 'Auth API', version: '1.0.0', description: 'Sign in with Google, Facebook, Telegram or email + password.' },
  paths,
  components: { securitySchemes: { jwtAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
};

export const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Auth API</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: '/api/schema/', dom_id: '#swagger-ui', persistAuthorization: true });
    </script>
  </body>
</html>
`;
