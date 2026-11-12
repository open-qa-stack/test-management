package com.example.policies;

@RestController
@RequestMapping("/policies")
public class PolicyController {
	private final PolicyRepository repository;

	@GetMapping(value = "/{policyId}")
	public ResponseEntity<PolicyDto> getPolicy(@PathVariable String policyId) {
		if (policyId.isEmpty()) {
			return ResponseEntity.notFound().build();
		}
		return ResponseEntity.ok(repository.find(policyId));
	}

	@PostMapping
	public ResponseEntity<PolicyDto> createPolicy(
			@RequestBody PolicyDto policy) {
		return ResponseEntity.ok(policy);
	}
}

interface PolicyRepository {
	PolicyDto find(String id);
}

enum PolicyType { HEALTH }

record PolicyDto(String id) {}
