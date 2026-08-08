FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true

COPY . .

EXPOSE 3002

CMD ["yarn", "start"]
