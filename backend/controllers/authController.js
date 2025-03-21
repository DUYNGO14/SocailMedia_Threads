import User from "../models/userModel.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import generateTokenAndSetCookie from "../utils/helpers/generateTokenAndSetCookie.js";
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();
const signupUser = async (req, res) => {
  try {
    const { name, username, email, dob, password } = req.body;

    // Kiểm tra xem username hoặc email đã tồn tại chưa
    const userExist = await User.findOne({ $or: [{ username }, { email }] });
    if (userExist && !userExist.facebookId && !userExist.googleId)
      return res
        .status(400)
        .json({ error: "Username or email  already exists" });
    else if (userExist && (userExist.facebookId || userExist.googleId)) {
      return res.status(400).json({
        error: "This account was registered with Google or Facebook. ",
      });
    }
    // Băm mật khẩu
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationOTP = generateOTP();
    // Tạo user mới
    const newUser = await User.create({
      name,
      username,
      email,
      dob,
      password: hashedPassword,
      verificationOTP,
      verificationOTPExpiresAt: Date.now() + 60 * 1000, // 1 minutes
    });

    // Tạo token và gửi cookie

    //send email verification
    //await sendVerificationEmail(user.email, verificationToken);

    // Trả về thông tin user (loại bỏ mật khẩu)
    res.status(201).json({
      success: true,
      message: "Email verified successfully",
      data: {
        _id: newUser._id,
        name: newUser.name,
        username: newUser.username,
        email: newUser.email,
        verificationOTP,
        verificationOTPExpiresAt: newUser.verificationOTPExpiresAt,
      },
    });
  } catch (error) {
    console.error("Error in signupUser:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

//login
const loginUser = async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    // Kiểm tra xem user có tồn tại không
    const user = await User.findOne({
      $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
    })
      .select("+password")
      .lean();
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }
    if (!user.password) {
      return res.status(400).json({
        error: "Tài khoản này được tạo bằng Google hoặc Facebook.",
      });
    }
    if (user.isVerified === false) {
      return res.status(400).json({ error: "Account not verified." });
    }
    // Kiểm tra mật khẩu có đúng không
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Tạo token và gửi cookie
    generateTokenAndSetCookie(user._id, res);

    // Cập nhật trạng thái user (nếu cần)
    await User.findByIdAndUpdate(user._id, { isFrozen: false });

    // Trả về dữ liệu user (trừ password)
    res.status(200).json({
      _id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      profilePic: user.profilePic,
      bio: user.bio,
    });
  } catch (error) {
    console.error("Error in loginUser:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const logoutUser = async (req, res) => {
  try {
    res.clearCookie("jwt");
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Error in logoutUser:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });
    // Tạo OTP mới
    const newOTP = generateOTP();
    user.verificationOTP = newOTP;
    user.verificationOTPExpiresAt = Date.now() + 60 * 1000; // 1 phút

    await user.save();

    // Gửi email chứa OTP mới (giả sử có hàm sendOTPEmail)
    //await sendOTPEmail(user.email, newOTP);

    res.json({ success: true, message: "OTP has been resent" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

const verifyEmail = async (req, res) => {
  const { email, code } = req.body;
  try {
    const user = await User.findOne({
      email,
      verificationOTP: code,
      verificationOTPExpiresAt: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired verification code",
      });
    }

    // Đánh dấu là đã xác thực
    user.isVerified = true;
    user.verificationOTP = undefined;
    user.verificationOTPExpiresAt = undefined;
    await user.save();

    // Gửi email chào mừng (nếu cần)
    // await sendWelcomeEmail(user.email, user.name);

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.log("Error in verifyEmail:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

//forgot password
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, error: "User not found" });
    }
    console.log(user);
    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    const resetTokenExpiresAt = Date.now() + 1 * 60 * 60 * 1000; // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiresAt = resetTokenExpiresAt;

    await user.save();
    console.log(
      "resetToken : ",
      `${process.env.CLIENT_URL}/reset-password/${resetToken}`
    );
    // send email
    // await sendPasswordResetEmail(
    //   user.email,
    //   `${process.env.CLIENT_URL}/reset-password/${resetToken}`
    // );

    res.status(200).json({
      success: true,
      message: "Password reset link sent to your email",
      data: {
        resetToken,
        resetTokenExpiresAt,
        resetLink: `${process.env.CLIENT_URL}/reset-password/${resetToken}`,
      },
    });
  } catch (error) {
    console.log("Error in forgotPassword ", error);
    res.status(400).json({ success: false, message: error.message });
  }
};
//reset password
const resetPassword = async (req, res) => {
  try {
    const { resetToken } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 5) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 5 characters long.",
      });
    }

    const user = await User.findOne({
      resetPasswordToken: resetToken,
      resetPasswordExpiresAt: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid or expired reset token" });
    }

    // Hash mật khẩu mới và lưu vào DB
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiresAt = undefined;

    await user.save();

    // Gửi email thông báo đặt lại mật khẩu thành công
    // await sendResetSuccessEmail(user.email);

    res
      .status(200)
      .json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

export {
  loginUser,
  signupUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
  logoutUser,
  resendOTP,
};
