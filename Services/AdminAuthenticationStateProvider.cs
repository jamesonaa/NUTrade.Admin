using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;
using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public class AdminAuthenticationStateProvider : AuthenticationStateProvider, IDisposable
{
    private readonly IFirebaseAuthService _authService;

    public AdminAuthenticationStateProvider(IFirebaseAuthService authService)
    {
        _authService = authService;
        _authService.OnAuthStateChanged += HandleAuthStateChanged;
    }

    public override Task<AuthenticationState> GetAuthenticationStateAsync()
    {
        var user = _authService.CurrentUser;
        if (user == null || !user.IsAdmin || !user.IsVerified || !user.EmailVerified || !_authService.IsSecurityVerified)
        {
            var anonymous = new ClaimsPrincipal(new ClaimsIdentity());
            return Task.FromResult(new AuthenticationState(anonymous));
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Uid),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
            new("VerificationStatus", user.VerificationStatus),
        };

        var identity = new ClaimsIdentity(claims, "FirebaseAuthScheme");
        var principal = new ClaimsPrincipal(identity);
        return Task.FromResult(new AuthenticationState(principal));
    }

    private void HandleAuthStateChanged()
    {
        NotifyAuthenticationStateChanged(GetAuthenticationStateAsync());
    }

    public void Dispose()
    {
        _authService.OnAuthStateChanged -= HandleAuthStateChanged;
    }
}
