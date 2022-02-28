# ASSET MANAGEMENT APPLICATIONS

This repository contains the source for all projects related to internal Asset Management.

## Contributors:

-   Sean Pond
-   Michael Johnson
-   Marlen Brunner

### Development

```
docker-compose -f docker-compose.dev.yaml up

# or if you can run bash
bin/dev up
```
> # `bin/dev` is the equivalent of `docker-compose -f docker-compose.dev.yaml`

Normalizing code before shipping can be accomplished via:

```bash
docker-compose -f docker-compose.dev.yaml exec api sh
npm run lint
# or
docker-compose -f docker-compose.dev.yaml exec web sh
npm run lint
```

#### Old Way

```
# at top level folder
docker-compose -f docker-compose.dev.yaml up

cd api
mv .env.example .env.development
# fill .env in relevant secrets
npm install
npm run start

cd ../web
npm install
npm run start
```

Normalizing code before shipping can be accomplished via:

`npm run lint` vai both the "web" or "api" package scripts.

### Production

This application runs in a Docker container

```
docker-compose up -d
```
