using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using NUTrade.Admin;
using NUTrade.Admin.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// Register HTTP client
builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

// Core NUTrade Services
builder.Services.AddSingleton<ToastService>();
builder.Services.AddScoped<IFirebaseAuthService, FirebaseAuthService>();
builder.Services.AddScoped<IFirestoreService, FirestoreService>();

// Blazor Authentication & RBAC Access Control
builder.Services.AddAuthorizationCore();
builder.Services.AddScoped<AuthenticationStateProvider, AdminAuthenticationStateProvider>();

await builder.Build().RunAsync();
