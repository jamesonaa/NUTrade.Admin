using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public interface IFirebaseAuthService
{
    UserProfile? CurrentUser { get; }
    bool IsAuthenticated { get; }
    bool IsSecurityVerified { get; }
    DateTime? SecurityCodeExpiresAt { get; }
    string? LastGeneratedCode { get; }
    event Action? OnAuthStateChanged;

    Task InitializeAsync();
    Task<AuthResult> SignInAsync(string email, string password);
    Task<SecurityVerificationResult> GenerateSecurityCodeAsync();
    Task<SecurityVerificationResult> VerifySecurityCodeAsync(string enteredCode);
    Task SignOutAsync();
    Task<bool> ResendEmailVerificationAsync(string? email = null);
    Task<UserProfile?> GetCurrentProfileAsync();
}
