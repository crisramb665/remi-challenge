# Two stages: compile with all dependencies, then run with the production ones only.
# pnpm is installed with npm because Node 25 and later no longer ship corepack.

FROM node:26-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# The settings come from the environment, see .env.example. Without them the app stops with a clear message.
CMD ["node", "dist/main.js"]
