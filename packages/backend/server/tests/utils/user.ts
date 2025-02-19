import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request, { type Response } from 'supertest';

import type { ClientTokenType, CurrentUser } from '../../src/core/auth';
import type { UserType } from '../../src/core/user';
import { gql } from './common';

export function sessionCookie(headers: any) {
  const cookie = headers['set-cookie']?.find((c: string) =>
    c.startsWith('sid=')
  );

  if (!cookie) {
    return null;
  }

  return cookie.split(';')[0];
}

export async function getSession(
  app: INestApplication,
  signInRes: Response
): Promise<{ user?: CurrentUser }> {
  const cookie = sessionCookie(signInRes.headers);
  const res = await request(app.getHttpServer())
    .get('/api/auth/session')
    .set('cookie', cookie)
    .expect(200);

  return res.body;
}

export async function signUp(
  app: INestApplication,
  name: string,
  email: string,
  password: string,
  autoVerifyEmail = true
): Promise<UserType & { token: ClientTokenType }> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
              signUp(name: "${name}", email: "${email}", password: "${password}") {
                id, name, email, token { token }
              }
            }
          `,
    })
    .expect(200);

  if (autoVerifyEmail) {
    await setEmailVerified(app, email);
  }

  return res.body.data.signUp;
}

async function setEmailVerified(app: INestApplication, email: string) {
  await app.get(PrismaClient).user.update({
    where: { email },
    data: {
      emailVerifiedAt: new Date(),
    },
  });
}

export async function currentUser(app: INestApplication, token: string) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            query {
              currentUser {
                id, name, email, emailVerified, avatarUrl, hasPassword,
                token { token }
              }
            }
          `,
    })
    .expect(200);
  return res.body.data.currentUser;
}

export async function sendChangeEmail(
  app: INestApplication,
  userToken: string,
  email: string,
  callbackUrl: string
): Promise<boolean> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(userToken, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
              sendChangeEmail(email: "${email}", callbackUrl: "${callbackUrl}")
            }
          `,
    })
    .expect(200);

  return res.body.data.sendChangeEmail;
}

export async function sendVerifyChangeEmail(
  app: INestApplication,
  userToken: string,
  token: string,
  email: string,
  callbackUrl: string
): Promise<boolean> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(userToken, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
              sendVerifyChangeEmail(token:"${token}", email: "${email}", callbackUrl: "${callbackUrl}")
            }
          `,
    })
    .expect(200);

  return res.body.data.sendVerifyChangeEmail;
}

export async function changeEmail(
  app: INestApplication,
  userToken: string,
  token: string,
  email: string
): Promise<UserType & { token: ClientTokenType }> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(userToken, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
               changeEmail(token: "${token}", email: "${email}") {
                id
                name
                avatarUrl
                email
              }
            }
          `,
    })
    .expect(200);
  return res.body.data.changeEmail;
}
