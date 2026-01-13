# Frontend Components

## Architecture

- **Stack**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **State**: React hooks + React Query for data fetching
- **Icons**: lucide-react

## Directory Structure

```
frontend/src/
├── components/
│   ├── ui/          # shadcn/ui primitives (Button, Input, etc.)
│   ├── chat/        # Chat-specific components
│   ├── sidebar/     # Navigation
│   └── admin/       # Admin dashboard
├── hooks/           # Custom hooks (useAuth, useAdmin)
├── lib/             # Utilities (api.ts, utils.ts)
└── pages/           # Page components
```

## Component Pattern

```typescript
interface MyComponentProps {
  title: string;
  onAction?: () => void;
}

export const MyComponent = ({ title, onAction }: MyComponentProps) => {
  const [state, setState] = useState('');

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
};
```

## Reference Examples

- Form with validation: `components/chat/ChatInput.tsx`
- Complex rendering: `components/chat/MessageItem.tsx`
- Collapsible sidebar: `components/sidebar/ChatSidebar.tsx`

## Key Conventions

- Use `cn()` from `lib/utils` for conditional classes
- Import paths use `@/` alias (e.g., `@/components/ui/button`)
- Named exports for components
- Props interface named `{Component}Props`
