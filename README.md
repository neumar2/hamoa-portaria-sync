# 🛡️ Hamoa Portaria Sync

> **Sistema de Gestão, Monitoramento de Acessos Faciais e Alertas de Vencimento por Quadra e Lote**  
> Desenvolvido para o **Hamoa Resort Residencial**. Licenciado sob a [Licença MIT](LICENSE).

---

## 📌 Visão Geral

O **Hamoa Portaria Sync** é uma aplicação completa para controle de portaria, gestão de prestadores de serviço e acompanhamento proativo de validade de biometrias faciais em condomínios e resorts residenciais.

O sistema integra-se de forma direta e segura com o banco de dados do **MDC 4WEB Residence (SQL Server)** e opcionalmente com planilhas de controle de categorias (Google Sheets), mantendo uma base de dados local rápida, com suporte a edições manuais locais ("soberania local"), busca instantânea por residência ou prestador, calendário visual de vencimentos e disparador de alertas formatados para WhatsApp.

---

## 🚀 Principais Funcionalidades

- **Calendário e Agenda de Vencimentos:** Visualização rápida dos prestadores cujo acesso facial expira hoje, amanhã, nos próximos 7 e 15 dias, ou que já se encontram vencidos.
- **Consulta por Residência / Lote:** Busca por Quadra/Lote (ex: `QD 01 - LT 02`) ou pelo nome do condômino responsável, listando todos os prestadores vinculados com crachá, matrícula, cargo e validade facial.
- **Busca Global Instantânea:** Localize qualquer prestador ou funcionário pelo nome com resultados em tempo real.
- **Alertas WhatsApp Formatados:** Gerador automático de mensagens prontas para envio aos condôminos via WhatsApp Web/App com pré-visualização ao vivo.
- **Sincronização Híbrida Inteligente:**
  - Extração direta via `sqlcmd` do SQL Server (`MDC4WEBDB`) com leitura não-bloqueante (`NOLOCK`).
  - Sincronização automatizada em segundo plano a cada 60 minutos com cronômetro em tempo real.
  - Botão **⚡ Sincronizar Agora** para sincronização sob demanda direto pela interface.
  - Proteção de edições locais manuais (`isEditadoManualmente`).
- **Autonomia Total de Servidor:** Execução contínua 24h/7d no Windows Server como serviço sob a conta de sistema (`NT AUTHORITY\SYSTEM`), com reinício automático no boot do servidor e recuperação de falhas em 1 minuto.

---

## 🔒 Segurança e Privacidade (LGPD)

Este repositório foi estruturado seguindo rigorosas diretrizes de segurança da informação e privacidade de dados:
- **Zero PII (Personally Identifiable Information):** Nenhum dado pessoal real de moradores, prestadores, números de documentos, telefones ou acessos é versionado no Git.
- **Isolamento de Credenciais:** Nenhuma senha ou IP confidencial está gravado no código-fonte. Todas as credenciais de produção são lidas exclusivamente de variáveis de ambiente via arquivo `.env` (ignorado pelo `.gitignore`).
- **Dados Demonstrativos:** O sistema inclui o arquivo `database/data.example.json` com dados fictícios para permitir testes imediatos após o clone.

---

## 🛠️ Tecnologias Utilizadas

- **Back-end:** [Node.js](https://nodejs.org/) (JavaScript CommonJS)
- **Servidor Web:** [Express.js](https://expressjs.com/) e [CORS](https://www.npmjs.com/package/cors)
- **Banco de Dados Relacional:** Microsoft SQL Server (MDC 4WEB) via `sqlcmd`
- **Armazenamento de Cache / Runtime:** JSON estruturado local com escrita atômica
- **Front-end:** HTML5, CSS3 moderno (Custom Properties, Flexbox/Grid) e Vanilla JavaScript
- **Ícones:** Phosphor Icons

---

## 📋 Pré-requisitos

Para rodar ou hospedar o sistema:
1. **Node.js** v18.x ou superior instalado ([Download Node.js](https://nodejs.org/)).
2. **Git** para clonar e versionar o código.
3. *(Opcional)* **SQL Server** com a ferramenta `sqlcmd` acessível no `PATH` do sistema para sincronização com o banco MDC.

---

## 💻 Instalação e Execução Local (Desenvolvimento / Teste)

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/SEU_USUARIO/hamoa-portaria-sync.git
   cd hamoa-portaria-sync
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente:**
   Copie o arquivo de exemplo `.env.example` para `.env`:
   ```bash
   copy .env.example .env
   ```
   Edite o `.env` com os dados do seu ambiente:
   ```env
   PORT=3344
   MDC_SQL_SERVER=localhost\SQLEXPRESS
   MDC_SQL_DATABASE=MDC4WEBDB
   MDC_SQL_USER=sa
   MDC_SQL_PASSWORD=SUA_SENHA_AQUI
   SYNC_INTERVAL_MINUTES=60
   ```

4. **Inicie a aplicação:**
   ```bash
   npm start
   ```
   *Ou execute com duplo clique em `INICIAR_MANUAL.bat` no Windows.*

5. **Acesse no navegador:**
   - Painel Local: [http://localhost:3344](http://localhost:3344)

---

## 🖥️ Implantação em Novo Servidor Windows (Produção 24/7)

Para instalar o sistema em um novo computador ou servidor Windows para rodar de forma 100% autônoma:

1. Instale o **Node.js (LTS)** no servidor.
2. Copie a pasta do projeto para o diretório de destino (ex: `D:\hamoa-portaria-sync`).
3. Crie e configure o arquivo `.env` com as credenciais do SQL Server local do servidor.
4. Clique com o botão direito em **`INSTALAR_SERVICO_AUTOMATICO.bat`** e selecione **"Executar como Administrador"**.

O script irá automaticamente:
- [x] Validar a instalação do Node.js.
- [x] Liberar a porta `3344` no Firewall do Windows para a rede interna.
- [x] Criar a tarefa agendada no Windows (`\HamoaPortariaSync`) com execução no boot (`onstart`) pela conta `NT AUTHORITY\SYSTEM`.
- [x] Desativar qualquer timeout de encerramento da tarefa (PT0S - nunca expira).
- [x] Iniciar o serviço imediatamente em segundo plano.

### Como parar ou reiniciar o serviço:
- **Para parar:** Execute `PARAR_SERVICO.bat` como Administrador.
- **Para reiniciar:** Execute `schtasks /run /tn "HamoaPortariaSync"` em um terminal com privilégios.

---

## 📁 Estrutura de Arquivos

```
hamoa-portaria-sync/
├── config.js                       # Leitor de variáveis de ambiente (.env)
├── server.js                       # Servidor HTTP Express e endpoints REST da API
├── package.json                    # Dependências e scripts do Node.js
├── LICENSE                         # Licença MIT
├── README.md                       # Documentação do projeto
├── .env.example                    # Modelo de configuração de variáveis
├── .gitignore                      # Regras de exclusão de dados e credenciais
├── INICIAR_MANUAL.bat              # Atalho para iniciar console localmente
├── INSTALAR_SERVICO_AUTOMATICO.bat # Instalador de serviço Windows 24/7 (SYSTEM)
├── PARAR_SERVICO.bat               # Encerramento do serviço Windows
├── database/
│   ├── db.js                       # Camada de abstração e sanitização do banco
│   ├── data.example.json           # Banco de dados modelo com registros fictícios
│   └── seed.js                     # Script auxiliar para população de dados
├── public/                         # Front-end da aplicação
│   ├── index.html                  # Interface do painel de portaria
│   ├── styles.css                  # Folha de estilos responsiva
│   └── app.js                      # Lógica cliente, buscas e integração REST
├── scripts/
│   ├── export_mdc_users.sql        # Query SQL otimizada com NOLOCK
│   ├── process_sync.js             # Processador de regras de negócio e sync
│   └── sync_nightly.bat            # Execução de sincronização manual via script
└── services/
    ├── googleSheetsLiveService.js  # Integração com planilhas externas
    ├── mdcSyncService.js           # Orquestrador de agendamento (60 min)
    └── notificationService.js      # Regras de cálculo de datas e alertas WhatsApp
```

---

## 📄 Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para obter mais informações.
