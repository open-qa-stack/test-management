using Microsoft.AspNetCore.Mvc;

namespace Lakeside.Policies;

[ApiController]
[Route("api/[controller]")]
public class PoliciesController : ControllerBase
{
    private readonly IPolicyRepository _repository;

    public PoliciesController(IPolicyRepository repository) => _repository = repository;

    [HttpGet("{id}")]
    public async Task<ActionResult<PolicyDto>> GetPolicy(string id)
    {
        var policy = await _repository.FindAsync(id);
        return policy is null ? NotFound() : Ok(policy);
    }

    [HttpPost("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public IActionResult Create([FromBody] PolicyDto dto) { return Ok(dto); }

    public string Name { get; set; } = "";
}

public interface IPolicyRepository { Task<PolicyDto?> FindAsync(string id); }
public record PolicyDto(string Id);
public enum PolicyKind { Health }
public struct Money { public decimal Amount; }
