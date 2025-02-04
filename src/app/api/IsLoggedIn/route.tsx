'use server'
import { NextRequest } from 'next/server';
import fs from 'fs';
import { cookies } from 'next/headers';
import { DBFile, execSelect, execUpdateDelete, getUserOptions, getUserSession, loginSuccessfullActions, tokenSeparator, validateSettings } from "../lib";
import IUser from '@/app/interfaces/IUser';

/**
 * @swagger
 * /api/IsLoggedIn:
 *    get:
 *        tags: 
 *          - Users
 *        summary: Return the status as to whether a user is logged in
 *        description: Return the status as to whether a user is logged in
 *        responses:
 *          200:
 *            description: '["OK",""] on success, ["ERROR","error message"] on error'
 */
export async function GET(request: NextRequest) {
     const currentCookies = await cookies();

     const searchParams = request.nextUrl.searchParams;

     const token = typeof searchParams.get("Token") !== "undefined" ? searchParams.get("Token") : null;

     const validationResult = await validateSettings();

     if (validationResult !== "") {
          return Response.json(["ERROR", false]);
     } else if (validationResult != "") {
          return Response.json(["ERROR", validationResult]);
     }

     if (!fs.existsSync(DBFile)) { // If DB file doesn't exist, this is a new WatchList instance
          // Clear session cookie if it existed previously but DB doesn't exist
          try {
               currentCookies.delete('userData');
          } catch(e) {}

          return Response.json(["ERROR", false]);
     }

     const userSession = await getUserSession(request);

     const userOptions = await getUserOptions(userSession?.UserID, userSession?.Admin);

     if (userSession && userSession?.UserID) {
          return Response.json([
               "OK",
               {
                    UserID: userSession?.UserID,
                    Username: userSession?.Username,
                    RealName: userSession?.Realname,
                    Admin: userSession?.Admin,
                    Options: userOptions
               }
          ]);
     } else if (token !== null) {
          // Validate token
          const tokenSplit = token.split(tokenSeparator);

          if (tokenSplit.length === 2) {
               const username = tokenSplit[0];
               const token = tokenSplit[1];

               const SQL = "SELECT * FROM Users WHERE Username = ? AND Token = ?";
               const params = [username, token];

               const results = await execSelect(SQL, params);

               if (results.length === 0) {
                    return Response.json(["ERROR", "Invalid username or password"]);
               }

               // Since the encryption is done in the API, we have to get the username and password and decrypt it in this endpoint
               const currentUser = results.filter((currentUser: IUser) => {
                    return username === currentUser.Username && token === currentUser.Token
               });

               if (currentUser.length !== 1) {
                    return Response.json(["ERROR", "Invalid username or password"]);
               }

               // Make sure that the token has not expired. If it has, delete it.
               const currentEpoch = new Date().getTime();
               const tokenExpirationNum = parseFloat(currentUser[0].TokenExpiration);

               if (currentEpoch >= tokenExpirationNum) {
                    const tokenSQL = "UPDATE Users SET Token=NULL, TokenExpiration=NULL WHERE UserID=?";
                    const tokenParams = [currentUser[0].UserID];

                    await execUpdateDelete(tokenSQL, tokenParams);

                    return Response.json(["ERROR", ""]);
               }

               return loginSuccessfullActions(currentUser);
          }
     } else {
          return Response.json(["ERROR", ""]);
     }
}