using System.ComponentModel.DataAnnotations;

namespace NUTrade.Admin.Models;

public class LoginRequest
{
    [Required(ErrorMessage = "NU Email address is required.")]
    [EmailAddress(ErrorMessage = "Please enter a valid email format.")]
    public string Email { get; set; } = string.Empty;

    [Required(ErrorMessage = "Password is required.")]
    [MinLength(6, ErrorMessage = "Password must be at least 6 characters.")]
    public string Password { get; set; } = string.Empty;

    public bool RememberMe { get; set; } = true;
}

public class AuthResult
{
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public UserProfile? User { get; set; }
    public string? Token { get; set; }
    public bool IsEmailUnverified { get; set; }
    public string? UnverifiedEmail { get; set; }
    public bool RequiresSecurityVerification { get; set; }
}

public class SecurityVerificationResult
{
    public bool Success { get; set; }
    public bool IsExpired { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime? ExpiresAt { get; set; }
}
