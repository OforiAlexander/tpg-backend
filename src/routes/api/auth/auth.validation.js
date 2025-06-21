// src/routes/api/auth/auth.validation.js - Auth Input Validation (FIXED)
const Joi = require('joi');

/**
 * Login validation schema - FIXED to accept both 'email' and 'login' fields
 */
const validateLogin = (data) => {
  const schema = Joi.object({
    email: Joi.string()
      .optional(),
    login: Joi.string()
      .optional(),
    password: Joi.string()
      .min(1)
      .required()
      .messages({
        'string.min': 'Password is required',
        'any.required': 'Password is required'
      }),
    rememberMe: Joi.boolean()
      .default(false),
    recaptchaToken: Joi.string()
      .optional()
      .allow('')
  }).custom((value, helpers) => {
    // Ensure at least one of email or login is provided
    if (!value.email && !value.login) {
      return helpers.error('any.required', { 
        message: 'Email or username is required' 
      });
    }
    
    if (value.email && !value.login) {
      value.login = value.email;
    }
    
    return value;
  }, 'Email or Login validation');

  return schema.validate(data, { abortEarly: false });
};

/**
 * Registration validation schema
 */
const validateRegister = (data) => {
  const schema = Joi.object({
    username: Joi.string()
      .alphanum()
      .min(3)
      .max(30)
      .required()
      .messages({
        'string.alphanum': 'Username must contain only letters and numbers',
        'string.min': 'Username must be at least 3 characters long',
        'string.max': 'Username must not exceed 30 characters',
        'any.required': 'Username is required'
      }),
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),
    password: Joi.string()
      .min(8)
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]'))
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'Password is required'
      }),
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Password confirmation is required'
      }),
    tpg_license_number: Joi.string()
      .pattern(/^TPG[0-9]{4,6}$/)
      .required()
      .messages({
        'string.pattern.base': 'TPG license number must be in format TPG followed by 4-6 digits',
        'any.required': 'TPG license number is required'
      }),
    pharmacy_name: Joi.string()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Pharmacy name must be at least 2 characters long',
        'string.max': 'Pharmacy name must not exceed 100 characters',
        'any.required': 'Pharmacy name is required'
      }),
    phone_number: Joi.string()
      .pattern(/^\+?[1-9]\d{1,14}$/)
      .required()
      .messages({
        'string.pattern.base': 'Please provide a valid phone number',
        'any.required': 'Phone number is required'
      }),
    address: Joi.string()
      .min(5)
      .max(200)
      .required()
      .messages({
        'string.min': 'Address must be at least 5 characters long',
        'string.max': 'Address must not exceed 200 characters',
        'any.required': 'Address is required'
      }),
    recaptchaToken: Joi.string()
      .optional()
      .allow('')
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Password reset request validation schema
 */
const validatePasswordReset = (data) => {
  const schema = Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),
    recaptchaToken: Joi.string()
      .optional()
      .allow('')
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Password change validation schema
 */
const validateChangePassword = (data) => {
  const schema = Joi.object({
    currentPassword: Joi.string()
      .min(1)
      .required()
      .messages({
        'string.min': 'Current password is required',
        'any.required': 'Current password is required'
      }),
    newPassword: Joi.string()
      .min(8)
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]'))
      .required()
      .messages({
        'string.min': 'New password must be at least 8 characters long',
        'string.pattern.base': 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'New password is required'
      }),
    confirmNewPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'New passwords do not match',
        'any.required': 'New password confirmation is required'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Email verification validation schema
 */
const validateEmailVerification = (data) => {
  const schema = Joi.object({
    token: Joi.string()
      .required()
      .messages({
        'any.required': 'Verification token is required'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Reset password with token validation schema
 */
const validateResetPassword = (data) => {
  const schema = Joi.object({
    token: Joi.string()
      .required()
      .messages({
        'any.required': 'Reset token is required'
      }),
    password: Joi.string()
      .min(8)
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]'))
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'Password is required'
      }),
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Password confirmation is required'
      })
  });

  return schema.validate(data, { abortEarly: false });
};

/**
 * Profile update validation schema
 */
const validateProfileUpdate = (data) => {
  const schema = Joi.object({
    username: Joi.string()
      .alphanum()
      .min(3)
      .max(30)
      .optional()
      .messages({
        'string.alphanum': 'Username must contain only letters and numbers',
        'string.min': 'Username must be at least 3 characters long',
        'string.max': 'Username must not exceed 30 characters'
      }),
    phone_number: Joi.string()
      .pattern(/^\+?[1-9]\d{1,14}$/)
      .optional()
      .messages({
        'string.pattern.base': 'Please provide a valid phone number'
      }),
    address: Joi.string()
      .min(5)
      .max(200)
      .optional()
      .messages({
        'string.min': 'Address must be at least 5 characters long',
        'string.max': 'Address must not exceed 200 characters'
      }),
    pharmacy_name: Joi.string()
      .min(2)
      .max(100)
      .optional()
      .messages({
        'string.min': 'Pharmacy name must be at least 2 characters long',
        'string.max': 'Pharmacy name must not exceed 100 characters'
      }),
    preferences: Joi.object()
      .optional()
  });

  return schema.validate(data, { abortEarly: false });
};

module.exports = {
  validateLogin,
  validateRegister,
  validatePasswordReset,
  validateChangePassword,
  validateEmailVerification,
  validateResetPassword,
  validateProfileUpdate
};