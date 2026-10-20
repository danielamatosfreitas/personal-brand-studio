import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Personal Brand OS | Capital Humano Intelligence',
  description: 'Sistema de gestão de conteúdo estratégico de Daniela Matos',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <head />
      <body className="min-h-screen bg-brand-background">
        {children}
      </body>
    </html>
  )
}
