<?php
namespace App\Controller;
interface PolicyRepository { public function find(string $id): ?array; }
class PolicyController
{
    #[Route('/policies/{id}', methods: ['GET'])]
    public function show(string $id): Response { return new Response(); }
}
function helper(): void {}
