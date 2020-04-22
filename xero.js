const { XeroClient } = require("xero-node");
const { TokenSet } = require("openid-client");
const jwtDecode = require("jwt-decode");
const fs = require("fs");
require("dotenv").config();

const port = process.env.PORT;
const client_id = process.env.XERO_CLIENT_ID;
const client_secret = process.env.XERO_CLIENT_SECRET;
const redirectUrl = `http://${process.env.SERVER}:${port}/xero/callback`;
const scopes =
  "openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions assets assets.read projects projects.read offline_access";
const xeroSessionFile = "./data/xeroSession";

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes.split(" "),
});

// A real implementation of these would save in a db or something shared between all api instances
function saveSession(session) {
  fs.writeFileSync(xeroSessionFile, JSON.stringify(session, null, "\t"));
}

function loadSession() {
  return JSON.parse(fs.readFileSync(xeroSessionFile));
}

// connect/callback are used by the admin and should only be needed to prime the system once with id/access token once (or if unused for 60 days)
/**
 * Handler just redirects caller (admin browser) to the Xero login page. Note that it actually
 * round trips to xero to get this url
 * @param {*} req
 * @param {*} res
 */
async function connect(req, res) {
  res.redirect(await xero.buildConsentUrl());
}

/**
 * After login, the admin's browser will get redirected to here, supplying the openid access tokens etc as args
 * round trips to xero to get this url
 * @param {*} req
 * @param {*} res
 */
async function callback(req, res) {
  try {
    const session = {
      tokenSet: await xero.apiCallback(req.url), // fetches the access token,refresh token, expiry info etc needed to keep the offline session alive
      tenants: await xero.updateTenants(), // I'm saving the tenant info here as it doesn't change and otherwise would need another round trip
    };

    // We'll save all this info as persistent data (on disk here but a Db table would be more appropriate
    saveSession(session);

    // Just splat all the infoin the return payload (not neeeded)
    res.json({
      session,
      decodedIdToken: jwtDecode(session.tokenSet.id_token),
      decodedAccessToken: jwtDecode(session.tokenSet.access_token),
      xero,
    });
  } catch (e) {
    res.status(500);
    res.json({
      error: e,
    });
  }
}

async function xeroClient() {
  // Typically this would be done in a middleware piece shared between all entry points - only really needs to be loaded from store once/saved on change
  const xero = new XeroClient();
  const session = loadSession();
  const tokenSet = new TokenSet(session.tokenSet);
  const expiresIn = tokenSet.expires_in;
  console.debug(`token expires in ${expiresIn} secs`);
  if (expiresIn < 60) {
    // if it expires in less than this number of seconds, refresh
    session.tokenSet = await xero.refreshWithRefreshToken(
      client_id,
      client_secret,
      tokenSet.refresh_token
    );
    saveSession(session);
    console.debug("refreshed");
  } else {
    xero.setTokenSet(tokenSet);
  }
  return { xero, tenantId: session.tenants[0].tenantId };
}

async function payments(req, res) {
  try {
    const { xero, tenantId } = await xeroClient();
    const studentId = req.params.studentId;

    // First get find the contact for the given student ID - this will always be set as the Account Number on each contact
    const {
      body: { contacts },
    } = await xero.accountingApi.getContacts(
      tenantId,
      undefined,
      `AccountNumber=="${studentId}"`
    );

    // Expecting exactly one (if more than one thats bad issue as the
    // order creation should have checked before creating another contact - Xero does actually enforce uniqueness on that field in the browser),
    // need to check if it does on creation from API
    if (contacts && contacts.length == 1) {
      const contactId = contacts[0].contactID;
      // Find the payments attached to invoices for this contact
      const { body: payments } = await xero.accountingApi.getPayments(
        tenantId,
        undefined,
        `Invoice.Contact.ContactID.Equals(GUID("${contactId}"))`
      );
      // All good, return the matching
      res.json(payments);
    } else {
      res.status(404).json({
        error: {
          message: `Expected a unique contact for studentId ${studentId}`,
        },
      });
    }
  } catch (e) {
    res.status(500);
    res.json({
      error: e,
    });
  }
}

if (require.main === module) {
  function serve() {
    server
      .use(cors(), express.json())
      .get("/xero/connect", connect)
      .get("/xero/callback", callback)
      .get("/payments/:studentId", payments)
      .listen(port, () => {
        console.log(`Server listening at ${port}`);
      });
  }
  // Run standalone
  const express = require("express");
  const cors = require("cors");
  const server = express();
  serve();
}

module.exports = { connect, callback, payments };
