using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public interface IFirebaseAuthService
{
    UserProfile? CurrentUser { get; }
    bool IsAuthenticated { get; }
    event Action? OnAuthStateChanged;

    Task InitializeAsync();
    Task<AuthResult> SignInAsync(string email, string password);
    Task SignOutAsync();
    Task<UserProfile?> GetCurrentProfileAsync();
}
