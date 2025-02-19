import '../../src/plugins/config';

import { HttpStatus, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ava, { TestFn } from 'ava';
import Sinon from 'sinon';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { CurrentUser } from '../../src/core/auth';
import { AuthService } from '../../src/core/auth/service';
import { UserService } from '../../src/core/user';
import { Config, ConfigModule } from '../../src/fundamentals/config';
import { GoogleOAuthProvider } from '../../src/plugins/oauth/providers/google';
import { OAuthService } from '../../src/plugins/oauth/service';
import { OAuthProviderName } from '../../src/plugins/oauth/types';
import { createTestingApp, getSession } from '../utils';

const test = ava as TestFn<{
  auth: AuthService;
  oauth: OAuthService;
  user: UserService;
  u1: CurrentUser;
  db: PrismaClient;
  app: INestApplication;
}>;

test.beforeEach(async t => {
  const { app } = await createTestingApp({
    imports: [
      ConfigModule.forRoot({
        plugins: {
          oauth: {
            providers: {
              google: {
                clientId: 'google-client-id',
                clientSecret: 'google-client-secret',
              },
            },
          },
        },
      }),
      AppModule,
    ],
  });

  t.context.auth = app.get(AuthService);
  t.context.oauth = app.get(OAuthService);
  t.context.user = app.get(UserService);
  t.context.db = app.get(PrismaClient);
  t.context.app = app;

  t.context.u1 = await t.context.auth.signUp('u1', 'u1@affine.pro', '1');
});

test.afterEach.always(async t => {
  await t.context.app.close();
});

test("should be able to redirect to oauth provider's login page", async t => {
  const { app } = t.context;

  const res = await request(app.getHttpServer())
    .get('/oauth/login?provider=Google')
    .expect(HttpStatus.FOUND);

  const redirect = new URL(res.header.location);
  t.is(redirect.origin, 'https://accounts.google.com');

  t.is(redirect.pathname, '/o/oauth2/v2/auth');
  t.is(redirect.searchParams.get('client_id'), 'google-client-id');
  t.is(
    redirect.searchParams.get('redirect_uri'),
    app.get(Config).baseUrl + '/oauth/callback'
  );
  t.is(redirect.searchParams.get('response_type'), 'code');
  t.is(redirect.searchParams.get('prompt'), 'select_account');
  t.truthy(redirect.searchParams.get('state'));
});

test('should throw if provider is invalid', async t => {
  const { app } = t.context;

  await request(app.getHttpServer())
    .get('/oauth/login?provider=Invalid')
    .expect(HttpStatus.BAD_REQUEST)
    .expect({
      statusCode: 400,
      message: 'Invalid OAuth provider',
      error: 'Bad Request',
    });

  t.assert(true);
});

test('should be able to save oauth state', async t => {
  const { oauth } = t.context;

  const id = await oauth.saveOAuthState({
    redirectUri: 'https://example.com',
    provider: OAuthProviderName.Google,
  });

  const state = await oauth.getOAuthState(id);

  t.truthy(state);
  t.is(state!.provider, OAuthProviderName.Google);
  t.is(state!.redirectUri, 'https://example.com');
});

test('should be able to get registered oauth providers', async t => {
  const { oauth } = t.context;

  const providers = oauth.availableOAuthProviders();

  t.deepEqual(providers, [OAuthProviderName.Google]);
});

test('should throw if code is missing in callback uri', async t => {
  const { app } = t.context;

  await request(app.getHttpServer())
    .get('/oauth/callback')
    .expect(HttpStatus.BAD_REQUEST)
    .expect({
      statusCode: 400,
      message: 'Missing query parameter `code`',
      error: 'Bad Request',
    });

  t.assert(true);
});

test('should throw if state is missing in callback uri', async t => {
  const { app } = t.context;

  await request(app.getHttpServer())
    .get('/oauth/callback?code=1')
    .expect(HttpStatus.BAD_REQUEST)
    .expect({
      statusCode: 400,
      message: 'Invalid callback state parameter',
      error: 'Bad Request',
    });

  t.assert(true);
});

test('should throw if state is expired', async t => {
  const { app } = t.context;

  await request(app.getHttpServer())
    .get('/oauth/callback?code=1&state=1')
    .expect(HttpStatus.BAD_REQUEST)
    .expect({
      statusCode: 400,
      message: 'OAuth state expired, please try again.',
      error: 'Bad Request',
    });

  t.assert(true);
});

test('should throw if provider is missing in state', async t => {
  const { app, oauth } = t.context;

  // @ts-expect-error mock
  Sinon.stub(oauth, 'getOAuthState').resolves({});

  await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .expect(HttpStatus.BAD_REQUEST)
    .expect({
      statusCode: 400,
      message: 'Missing callback state parameter `provider`',
      error: 'Bad Request',
    });

  t.assert(true);
});

test('should throw if provider is invalid in callback uri', async t => {
  const { app, oauth } = t.context;

  // @ts-expect-error mock
  Sinon.stub(oauth, 'getOAuthState').resolves({ provider: 'Invalid' });

  await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .expect(HttpStatus.BAD_REQUEST)
    .expect({
      statusCode: 400,
      message: 'Invalid provider',
      error: 'Bad Request',
    });

  t.assert(true);
});

function mockOAuthProvider(app: INestApplication, email: string) {
  const provider = app.get(GoogleOAuthProvider);
  const oauth = app.get(OAuthService);

  Sinon.stub(oauth, 'getOAuthState').resolves({
    provider: OAuthProviderName.Google,
    redirectUri: '/',
  });

  // @ts-expect-error mock
  Sinon.stub(provider, 'getToken').resolves({ accessToken: '1' });
  Sinon.stub(provider, 'getUser').resolves({
    id: '1',
    email,
    avatarUrl: 'avatar',
  });
}

test('should be able to sign up with oauth', async t => {
  const { app, db } = t.context;

  mockOAuthProvider(app, 'u2@affine.pro');

  const res = await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .expect(HttpStatus.FOUND);

  const session = await getSession(app, res);

  t.truthy(session.user);
  t.is(session.user!.email, 'u2@affine.pro');

  const user = await db.user.findFirst({
    select: {
      email: true,
      connectedAccounts: true,
    },
    where: {
      email: 'u2@affine.pro',
    },
  });

  t.truthy(user);
  t.is(user!.email, 'u2@affine.pro');
  t.is(user!.connectedAccounts[0].providerAccountId, '1');
});

test('should throw if account register in another way', async t => {
  const { app, u1 } = t.context;

  mockOAuthProvider(app, u1.email);

  const res = await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .expect(HttpStatus.FOUND);

  const link = new URL(res.headers.location);

  t.is(link.pathname, '/signIn');
  t.is(
    link.searchParams.get('error'),
    'The account with provided email is not register in the same way.'
  );
});

test('should be able to fullfil user with oauth sign in', async t => {
  const { app, user, db } = t.context;

  const u3 = await user.createUser({
    name: 'u3',
    email: 'u3@affine.pro',
    registered: false,
  });

  mockOAuthProvider(app, u3.email);

  const res = await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .expect(HttpStatus.FOUND);

  const session = await getSession(app, res);

  t.truthy(session.user);
  t.is(session.user!.email, u3.email);

  const account = await db.connectedAccount.findFirst({
    where: {
      userId: u3.id,
    },
  });

  t.truthy(account);
});

test('should throw if oauth account already connected', async t => {
  const { app, db, u1, auth } = t.context;

  await db.connectedAccount.create({
    data: {
      userId: u1.id,
      provider: OAuthProviderName.Google,
      providerAccountId: '1',
    },
  });

  // @ts-expect-error mock
  Sinon.stub(auth, 'getUser').resolves({ id: 'u2-id' });

  mockOAuthProvider(app, 'u2@affine.pro');

  const res = await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .set('cookie', 'sid=1')
    .expect(HttpStatus.FOUND);

  const link = new URL(res.headers.location);

  t.is(link.pathname, '/signIn');
  t.is(
    link.searchParams.get('error'),
    'The third-party account has already been connected to another user.'
  );
});

test('should be able to connect oauth account', async t => {
  const { app, u1, auth, db } = t.context;

  // @ts-expect-error mock
  Sinon.stub(auth, 'getUser').resolves({ id: u1.id });

  mockOAuthProvider(app, u1.email);

  await request(app.getHttpServer())
    .get(`/oauth/callback?code=1&state=1`)
    .set('cookie', 'sid=1')
    .expect(HttpStatus.FOUND);

  const account = await db.connectedAccount.findFirst({
    where: {
      userId: u1.id,
    },
  });

  t.truthy(account);
  t.is(account!.userId, u1.id);
});
