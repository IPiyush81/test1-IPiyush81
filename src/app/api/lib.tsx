import axios from "axios";
import config from "config";
import fs from "fs";
import { cookies } from 'next/headers';
import * as CryptoJS from 'crypto-js';
import { NextRequest } from 'next/server';
import IUser from "../interfaces/IUser";
import { open } from 'sqlite'
import sqlite3 from "sqlite3";

// Constants
export const DBFile = "watchlistdb.sqlite";
export const watchListSQL = "CREATE TABLE WatchList (WatchListID INTEGER PRIMARY KEY, UserID INTEGER NOT NULL, WatchListItemID INTEGER NOT NULL, StartDate VARCHAR(80), EndDate VARCHAR(80), WatchListSourceID INTEGER, Season INTEGER, Archived TINYINT(1), Notes VARCHAR(200), Rating DECIMAL(18,2));";
export const watchListItemsSQL = "CREATE TABLE WatchListItems(WatchListItemID INTEGER PRIMARY KEY,WatchListItemName VARCHAR(500),WatchListTypeID INTEGER,IMDB_URL VARCHAR(200),IMDB_Poster VARCHAR(2000),ItemNotes VARCHAR(200),Archived TINYINT(1), IMDB_JSON TEXT NULL);";
export const watchListSourcesSQL = "CREATE TABLE WatchListSources (WatchListSourceID INTEGER PRIMARY KEY, WatchListSourceName VARCHAR(80) NOT NULL);";
export const watchListTypesSQL = "CREATE TABLE WatchListTypes (WatchListTypeID INTEGER PRIMARY KEY, WatchListTypeName VARCHAR(80) NOT NULL);";
export const usersSQL = "CREATE TABLE Users (UserID INTEGER PRIMARY KEY, Username BLOB NOT NULL, Realname BLOB NOT NULL, Password BLOB NOT NULL, Admin BIT NULL DEFAULT 0, Enabled NULL DEFAULT 0, Token TEXT NULL, TokenExpiration INTEGER NULL);";
export const bugLogsSQL = "CREATE TABLE BugLogs (WLBugID INTEGER PRIMARY KEY, WLBugName TEXT NOT NULL, AddDate TEXT NOT NULL,CompletedDate TEXT NULL, ResolutionNotes TEXT NULL);";
export const optionsSQL = "CREATE TABLE Options (`OptionID` INTEGER PRIMARY KEY, UserID INT, ArchivedVisible TINYINT(1), AutoAdd TINYINT(1), DarkMode TINYINT(1), HideTabs TINYINT(1), SearchCount INT, StillWatching TINYINT(1), ShowMissingArtwork TINYINT(1), SourceFilter INT, TypeFilter INT, WatchListSortColumn VARCHAR(100), WatchListSortDirection VARCHAR(100), VisibleSections VARCHAR(1000));"
export const visibleSectionsSQL = "CREATE TABLE VisibleSections (id INTEGER PRIMARY KEY, name VARCHAR(100));"

export const defaultSources = ['Amazon', 'Hulu', 'Movie Theatre', 'Netflix', 'Plex', 'Prime', 'Web'];
export const defaultTypes = ['Movie', 'Other', 'Special', 'TV'];
export const tokenSeparator = "*****";
const timeout = 604800000; // 1 week in MS

const secretKey = config.get(`Secret`);

export const logMessage = async (message) => {
     message = new Date().toISOString() + " " + message
     fs.appendFile('app.log', message + '\n', (err) => {
          if (err) {
               console.error('Error appending to log file:', err);
          }
     });
};

export const addUser = async (request: NextRequest, isNewInstance = false) => {
     const searchParams = request.nextUrl.searchParams;

     const userName = searchParams.get("wl_username");
     const realName = searchParams.get("wl_realname");
     const password = searchParams.get("wl_password");
     const isAdmin = searchParams.get("wl_admin") !== "undefined" && (searchParams.get("wl_admin") === "true" || isNewInstance === true) ? 1 : 0;

     if (userName === null) {
          return Response.json(["User Name was not provided"]);
     } else if (realName === null) {
          return Response.json(["Real name was not provided"]);
     } else if (password === null) {
          return Response.json(["Password was not provided"]);
     }
     // This action should only be performed by logged in users who are an admin when not setting up new instance
     if (!isNewInstance) {
          const isAdminResult = await isUserAdmin(request);

          if (!isAdminResult) {
               return Response.json(["ERROR", `addUser(): Access Denied`]);
          }
     }

     const SQL = "INSERT INTO Users(UserName, Realname, Password, Admin, Enabled) VALUES (?, ?, ?, ?, ?);";

     const params = [encrypt(String(userName)), encrypt(String(realName)), encrypt(String(password)), isAdmin, 1];

     const result = await execInsert(SQL, params);

     const newID = result.lastID;

     return Response.json(["OK", newID]);
}

export const decrypt = (cipherText: string) => {
     const bytes = CryptoJS.AES.decrypt(cipherText, secretKey)
     const plainText = bytes.toString(CryptoJS.enc.Utf8)
     return plainText
}

export const encrypt = (plainText: string) => {
     const cipherText = CryptoJS.AES.encrypt(plainText, secretKey).toString()
     return cipherText
}

export const execInsert = async (sql: string, params: Array<string | number | null>) => {
     const db = await openDB();

     try {
          const stmt = await db.prepare(sql);

          return await stmt.run(params);
     } catch (e) {
          return e;
     }
}

export const execSelect = async (sql: string, params: Array<string | number>) => {
     const db = await openDB();

     interface Row {
          [key: string]: unknown;  // Use `unknown` if row structure is dynamic, or define more specific properties
     }

     try {
          const stmt = await db.prepare(sql);

          const results: Row[] = [];

          await stmt.each(params, function (_err: unknown, row: Row) {
               results.push(row);
          });

          stmt.finalize();

          db.close();

          return results;
     } catch (e) {
          return e;
     }
}

export const execUpdateDelete = async (sql: string, params: Array<string | number>) => {
     const db = await openDB();

     try {
          const stmt = await db.prepare(sql);

          await stmt.run(params);
     } catch (e) {
          return e;
     }
}

export const fetchData = async (options) => {
     try {
          const response = await axios(options);
          return response.data;
     } catch (error) {
          throw error;
     }
}

export const getIMDBDetails = async (imdb_id: string) => {
     const rapidapi_key = config.has("RapidAPIKey") ? config.get("RapidAPIKey") : "";

     let options = {
          method: "GET",
          url: "https://imdb107.p.rapidapi.com/",
          params: { i: imdb_id, r: "json" },
          headers: {
               "x-rapidapi-host": "movie-database-alternative.p.rapidapi.com",
               "x-rapidapi-key": rapidapi_key,
               useQueryString: true,
          },
     };

     const result = await fetchData(options);

     return result;
}

export const getRapidAPIKey = async () => {
     const rapidapi_key = config.has("RapidAPIKey") ? config.get("RapidAPIKey") : "";

     return rapidapi_key;
}

export const getRecommendationsAPIKey = async () => {
     const recommendations_key = config.has("RecommendationsAPIKey") ? config.get("RecommendationsAPIKey") : "";

     return recommendations_key;
}

export const getUserID = async (req: NextRequest) => {
     const userSession = await getUserSession(req);

     if (userSession !== null && typeof userSession !== "undefined" && typeof userSession.UserID !== "undefined") {
          return userSession.UserID;
     } else {
          return null;
     }
}

export const getUserOptions = async (userID: number, isAdmin: boolean) => {
     // Get Users' options
     const getOptionsSQL = `SELECT * FROM Options WHERE UserID=?`;
     const params = [userID];

     // There may be no options the first time ever getting the options
     let userOptions = await execSelect(getOptionsSQL, params);

     if (userOptions.length === 0) {
          const visibleSectionsChoicesResult = await execSelect(`SELECT * FROM VisibleSections ${isAdmin === false ? " WHERE name != 'Admin'" : ""}`, []);
          const visibleSectionsChoices = JSON.stringify(visibleSectionsChoicesResult);

          await execInsert("INSERT INTO Options (UserID, ArchivedVisible, AutoAdd, DarkMode, HideTabs, SearchCount, StillWatching, ShowMissingArtwork, SourceFilter, TypeFilter, WatchListSortColumn, WatchListSortDirection, VisibleSections) VALUES (" + userID + ", false, true, true, false, 5, true, false, -1, -1,\"Name\", \"ASC\",'" + visibleSectionsChoices + "');", []);
     }

     userOptions = await execSelect(getOptionsSQL, params);

     return userOptions;
}

export const getUserSession = async (req: NextRequest) => {
     const cookiesVal = await cookies();
     const userData = cookiesVal.get('userData');

     if (typeof userData === "undefined") {
          return null;
     } else {
          const userObj = JSON.parse(userData.value);
          return userObj;
     }
}

export const isLoggedIn = async (req: NextRequest) => {
     const userSession = await getUserSession(req);

     if (typeof userSession === "undefined") {
          return false;
     } else {
          return true;
     }
}

export const isUserAdmin = async (req: NextRequest) => {
     const userSession = await getUserSession(req);

     if (typeof userSession === "undefined" || (typeof userSession !== "undefined" && userSession.Admin === 0)) {
          return false;
     } else if (userSession.Admin === 1) {
          return true;
     } else {
          return false;
     }
}

export const login = async (username: string, password: string) => {
     try {
          const SQL = "SELECT UserID,Username,Password,Realname,Admin FROM Users WHERE Enabled=1";

          const results = await execSelect(SQL, []);

          if (results.length === 0) {
               return Response.json(["ERROR", "Invalid username or password"]);
          }

          // Since the encryption is done in the API, we have to get the username and password and decrypt it in this endpoint
          const currentUser = results.filter((currentUser: IUser) => {
               return username === decrypt(currentUser.Username) && password === decrypt(currentUser.Password)
          });

          if (currentUser.length !== 1) {
               return Response.json(["ERROR", "Invalid username or password"]);
          }

          return loginSuccessfullActions(currentUser);

     } catch (err: any) {
          return Response.json(["ERROR", `The error ${err.message} occurred logging in`]);
     }
}

export const loginSuccessfullActions = async (currentUser: IUser) => {
     // Generate token
     const epochTime = new Date().getTime().toString();
     const token = encrypt(btoa(epochTime));

     const tokenExpiration = new Date().getTime() + timeout;

     const tokenSQL = "UPDATE Users SET Token=?, TokenExpiration=? WHERE UserID=?";
     const tokenParams = [token, tokenExpiration, currentUser[0].UserID];

     try {
          await execUpdateDelete(tokenSQL, tokenParams);

          const userOptions = await getUserOptions(currentUser[0].UserID, currentUser[0].Admin === 1 ? true : false);

          const userData = {
               UserID: currentUser[0].UserID,
               Username: decrypt(currentUser[0].Username),
               Realname: decrypt(currentUser[0].Realname),
               Admin: currentUser[0].Admin,
               Token: `${currentUser[0].Username}${tokenSeparator}${token}`,
               Timeout: timeout,
               Options: userOptions
          }

          const expires = new Date(Date.now() + 3600000);

          const currentCookies = await cookies();

          currentCookies.set('userData', JSON.stringify(userData), { expires: expires });

          return Response.json(["OK", userData]);
     } catch (e) {
          return Response.json(["ERROR", `An error occurred getting the options with the error ${e.message}`]);
     }
}

const openDB = async () => {
     return await open({
          filename: DBFile,
          driver: sqlite3.Database,
     });
}

export const validateSettings = async () => {
     // Validate config file properties that are required
     if (!config.has(`Secret`)) {
          return `Config file error: Secret property is missing or not set`;
     }

     return "";
}
