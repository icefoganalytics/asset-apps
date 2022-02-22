import { Express, NextFunction, Request, Response } from "express";
import * as ExpressSession from "express-session";
import { AuthUser } from "../data";
import { AUTH_REDIRECT, FRONTEND_URL } from "../config";
import { UserService } from "../services";

import { auth } from "express-openid-connect";

const db = new UserService();

function authenticationForEverywhereExcept(excludes: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (excludes.includes(req.path)) {
            return next();
        }

        if (req.oidc.isAuthenticated()) {
            return next();
        }

        res.status(401).send("Not authenticated");
    };
}

export function configureAuthentication(app: Express) {
    app.use(
        ExpressSession.default({
            secret: "supersecret",
            resave: true,
            saveUninitialized: true,
        })
    );

    app.use(
        auth({
            authRequired: false,
            auth0Logout: false,
            authorizationParams: {
                response_type: "code",
                audience: "",
                scope: "openid profile email",
            },
            routes: {
                login: "/api/auth/login",
                //logout: "/api/auth/logout",
                postLogoutRedirect: FRONTEND_URL,
            },
        })
    );

    app.use(
        authenticationForEverywhereExcept([
            "/api/auth/login",
            "/api/auth/is-authenticated",
        ])
    );

    app.use("/", async (req: Request, res: Response, next: NextFunction) => {
        if (req.oidc.isAuthenticated()) {
            let oidcUser = AuthUser.fromOpenId(req.oidc.user);
            //(req.session as any).user = oidcUser;
            //req.user = oidcUser;

            let dbUser = await db.getByEmail(oidcUser.email);
            req.user = await db.makeDTO(Object.assign(oidcUser, dbUser));
        }

        next();
    });

    app.get("/", async (req: Request, res: Response) => {
        if (req.oidc.isAuthenticated()) {
            let user = AuthUser.fromOpenId(req.oidc.user) as AuthUser;
            req.user = user;

            let dbUser = await db.getByEmail(req.user.email);

            if (!dbUser) {
                console.log("CREATING USER");
                await db.create(
                    user.email,
                    user.first_name,
                    user.last_name,
                    "Active",
                    ""
                );
            }

            res.redirect(AUTH_REDIRECT);
        } else {
            // this is hard-coded to accomodate strage behaving in sendFile not allowing `../` in the path.
            // this won't hit in development because web access is served by the Vue CLI - only an issue in Docker
            res.sendFile("/home/node/app/dist/web/index.html");
        }
    });

    app.get(
        "/api/auth/is-authenticated",
        async (req: Request, res: Response) => {
            if (req.oidc.isAuthenticated()) {
                return res.json({ data: true });
            }

            return res.json({ data: false });
        }
    );

    app.get("/api/auth/logout", async (req: any, res) => {
        req.session.destroy();
        res.status(401);
        await (res as any).oidc.logout();
    });
}
