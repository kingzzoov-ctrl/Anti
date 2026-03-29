import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export { toast }

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}

type BadgeVariant = 'default' | 'outline' | 'destructive'

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  const styles = {
    default: 'bg-primary/15 text-primary border border-primary/20',
    outline: 'border border-border text-muted-foreground',
    destructive: 'border border-destructive/20 bg-destructive/10 text-destructive',
  }
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs', styles[variant], className)} {...props} />
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'default' | 'sm' | 'icon'
}) {
  const variants = {
    default: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border bg-transparent hover:bg-muted',
    ghost: 'bg-transparent hover:bg-muted',
    destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  }
  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 px-3 text-sm',
    icon: 'h-10 w-10',
  }
  return <button className={cn('inline-flex items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50', variants[variant], sizes[size], className)} {...props} />
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary', props.className)} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('flex min-h-[96px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary', props.className)} />
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-px w-full bg-border', className)} {...props} />
}

export function LoadingOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-xl">{children}</div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-5 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

export function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted')}
    >
      <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white transition-transform', checked ? 'translate-x-5' : 'translate-x-1')} />
    </button>
  )
}

type TabsContextValue = {
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

export function Tabs({ defaultValue, children }: { defaultValue: string; children: React.ReactNode }) {
  const [value, setValue] = useState(defaultValue)
  const ctx = useMemo(() => ({ value, setValue }), [value])
  return <TabsContext.Provider value={ctx}>{children}</TabsContext.Provider>
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex rounded-xl border border-border bg-muted/40 p-1', className)} {...props} />
}

export function TabsTrigger({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const ctx = useContext(TabsContext)
  if (!ctx) return null
  const active = ctx.value === value
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={cn('rounded-lg px-3 py-1.5 transition-colors', active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground', className)}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const ctx = useContext(TabsContext)
  if (!ctx || ctx.value !== value) return null
  return <div className={className}>{children}</div>
}

export function Select({
  value,
  onValueChange,
  children,
}: {
  value?: string
  onValueChange: (value: string) => void
  children: React.ReactNode
}) {
  const options: Array<{ value: string; label: React.ReactNode }> = []
  let trigger: React.ReactNode = null

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if ((child.type as any).displayName === 'SelectTrigger') trigger = child
    if ((child.type as any).displayName === 'SelectContent') {
      React.Children.forEach((child.props as { children?: React.ReactNode }).children, (item) => {
        if (!React.isValidElement(item)) return
        if ((item.type as any).displayName === 'SelectItem') {
          options.push({ value: item.props.value, label: item.props.children })
        }
      })
    }
  })

  return (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cn('flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary', (trigger as any)?.props?.className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label as any}</option>
      ))}
    </select>
  )
}

export function SelectTrigger({ children }: { children?: React.ReactNode; className?: string }) {
  return <>{children}</>
}
SelectTrigger.displayName = 'SelectTrigger'

export function SelectContent({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}
SelectContent.displayName = 'SelectContent'

export function SelectItem({ children }: { value: string; children?: React.ReactNode }) {
  return <>{children}</>
}
SelectItem.displayName = 'SelectItem'

export function SelectValue() {
  return null
}

const DialogContext = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null)

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return <DialogContext.Provider value={{ open, setOpen: onOpenChange }}>{children}</DialogContext.Provider>
}

export function DialogContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(DialogContext)
  if (!ctx?.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={() => ctx.setOpen(false)}>
      <div className={cn('w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl', className)} onClick={(e) => e.stopPropagation()} {...props}>
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)} {...props} />
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold text-foreground', className)} {...props} />
}

export function Avatar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)} {...props} />
}

export function AvatarFallback({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex h-full w-full items-center justify-center rounded-full bg-muted', className)} {...props} />
}
