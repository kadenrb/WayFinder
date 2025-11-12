const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

const requireAuth = (req, res, next) => {
	const authHeader = req.headers.authorization;
	if (!authHeader)
		return res.status(401).json({ message: " No token provided " });

	const token = authHeader.split(" ")[1];
	try {
		const payload = jwt.verify(token, JWT_SECRET);
		req.user = payload;
		next();
	} catch (err) {
		return res.status(401).json({ message: " Invalid token " });
	}
};

module.exports = requireAuth;

