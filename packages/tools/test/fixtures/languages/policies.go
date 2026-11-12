package policies

type Policy struct{ ID string }
type Repository interface{ Find(id string) (*Policy, error) }

func (s *Service) Find(id string) (*Policy, error) { return nil, nil }
func NewService() *Service { return &Service{} }
type PolicyID string
