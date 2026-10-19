using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public interface IFirebaseAuthService
{
    UserProfile? CurrentUser { get; }
    bool IsAuthenticated { get; }
    bool IsSecurityVerified { get; }
    DateTime? SecurityCodeExpiresAt { get; }
    event Action? OnAuthStateChanged;

    Task InitializeAsync();
    Task<AuthResult> SignInAsync(string email, string password);
    Task<SecurityVerificationResult> GenerateSecurityCodeAsync();
    Task<SecurityVerificationResult> VerifySecurityCodeAsync(string enteredCode);
    Task SignOutAsync();
    Task<bool> ResendEmailVerificationAsync(string? email = null);
    Task<UserProfile?> GetCurrentProfileAsync();

    // Forgot password through the app's Brevo-backed callables (code mailed, never a Firebase reset link).
    Task<FunctionResult> StartPasswordResetAsync(string email);
    Task<FunctionResult> VerifyPasswordResetCodeAsync(string email, string code);
    Task<FunctionResult> CompletePasswordResetAsync(string email, string resetToken, string password);
}
