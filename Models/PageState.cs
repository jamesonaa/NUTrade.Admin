namespace NUTrade.Admin.Models;

// Current page and page size for one paginated list; rendered by Components/Pager.razor.
public sealed class PageState
{
    public static readonly int[] SizeOptions = { 10, 25, 50 };

    public PageState(int size = 10) => Size = size;

    public int Page { get; private set; } = 1;
    public int Size { get; private set; }

    public int TotalPages(int totalCount) => Math.Max(1, (int)Math.Ceiling(totalCount / (double)Size));

    // Clamps the current page to the filtered row count, so a narrower filter never leaves an empty page.
    public List<T> Slice<T>(IReadOnlyList<T> rows)
    {
        Page = Math.Clamp(Page, 1, TotalPages(rows.Count));
        return rows.Skip((Page - 1) * Size).Take(Size).ToList();
    }

    public void GoTo(int page) => Page = Math.Max(1, page);

    public void SetSize(int size)
    {
        Size = size > 0 ? size : Size;
        Page = 1;
    }

    public void Reset() => Page = 1;
}
