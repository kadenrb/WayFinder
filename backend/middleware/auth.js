// import the jsonwebtoken libary
const jwt = require("jsonwebtoken");
// load the JWT secret from environment variables (with a fallback)
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

/*
 * middleware to protect routes by requiring a vaild JWT token.
 * extracts the token from the authorization header,
 * and attaches the decoded user information to the request object .
 */

const requireAuth = (req, res, next) => {
	//retireve the authorization header
	const authHeader = req.headers.authorization;
	// if the header is missing , deny access
	if (!authHeader)
		return res.status(401).json({ message: " No token provided " });

	// extract the token from the header
	const token = authHeader.split(" ")[1];
	try {
		// verify the token using secret key
		const payload = jwt.verify(token, JWT_SECRET);
		// attach the decoded payload to the request object
		req.user = payload;
		// proceed to the next middleware or route handler
		next();
	} catch (err) {
		// if verification fails, deny access
		return res.status(401).json({ message: " Invalid token " });
	}
};

// export the requireAuth middleware
module.exports = requireAuth;
