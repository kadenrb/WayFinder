// load envrioment variables from .env file
require("dotenv").config();
// Import jsonwebtoken libary to verify JWT tokens
const jwt = require("jsonwebtoken");

/*
 * Middleware to authenticate admin users using JWT tokens.
 * it checks for authorization header, verfifies the token
 * and attches the adminID to the request object.
 * if authentication fails, it sends user back to home user page.
 */

function authController(req, res, next) {
	// get authorization header
	const authHeader = req.headers.authorization;
	// if the header is missing, the user is unauthorized.
	if (!authHeader)
		return res.status(401).json({ error: "Missing Authorization header" });

	// extract token from header
	const token = authHeader.split(" ")[1];
	// if no token is provided, give this error
	if (!token) return res.status(401).json({ error: "No token provided" });

	try {
		// verify the token using the secret key
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		// attach adminId to request object for further use
		req.adminId = decoded.adminId;
		// proceed to the next middleware or route handler
		next();
	} catch (err) {
		// if token verification fails, send unauthorized error
		return res.status(401).json({ error: "Invalid token" });
	}
}

// export the authcontroller middleware
module.exports = authController;
