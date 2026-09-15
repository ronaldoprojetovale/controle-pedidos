# Guia de configuração — Controle de Pedidos

Este app é um arquivo web simples (funciona em qualquer celular pelo navegador,
sem loja de aplicativos). Para os pedidos e fotos aparecerem sincronizados
entre os celulares de todo mundo (Cristian, Pietro, Rodrigues, Ricardo,
Gabriel, Davi e ADM), ele usa o **Firebase**, uma ferramenta do Google.

**A Parte 1 abaixo (criar e configurar o projeto Firebase) eu já fiz por
você** — o projeto `controle-pedidos` já está criado, com Firestore,
Storage, login anônimo e as regras de segurança publicadas, e o `app.js`
já vem com a configuração preenchida. Deixei os passos aqui só de
referência, caso um dia você precise recriar ou entender o que foi feito.

O que falta é só a **Parte 2**: publicar os arquivos num link que todos
possam abrir no celular. Isso leva uns 5 minutos.

---

## Parte 1 — Criar o projeto Firebase (já feito para você ✓)

1. Acesse **console.firebase.google.com** e entre com uma conta Google (pode
   ser sua conta pessoal ou uma conta criada só para a empresa).
2. Clique em **"Criar projeto"**, dê um nome (ex.: `pedidos-projetovale`) e
   siga os passos padrão (pode desativar o Google Analytics, não é
   necessário).
3. Dentro do projeto, no menu à esquerda:
   - Clique em **Compilação → Firestore Database → Criar banco de dados**.
     Escolha uma localização (ex.: `southamerica-east1` — São Paulo) e inicie
     em **modo de produção**.
   - Clique em **Compilação → Storage → Vamos começar**. Aceite a
     localização padrão (a mesma região é o ideal).
   - Clique em **Compilação → Authentication → Vamos começar**. Na aba
     **Sign-in method** (Método de login), ative a opção **Anônimo**
     (Anonymous) e salve. *(Isso permite que o app reconheça cada celular
     sem exigir e-mail ou senha de ninguém.)*

4. Ainda no projeto, clique no ícone de **engrenagem ⚙ → Configurações do
   projeto**. Role até **"Seus apps"** e clique no ícone **`</>`** (Web) para
   registrar um app. Dê um apelido (ex.: `app-pedidos`) e clique em
   **Registrar app**. Não precisa marcar a opção de Hosting.

5. O Firebase vai mostrar um bloco de código parecido com este:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...........................",
     authDomain: "pedidos-projetovale.firebaseapp.com",
     projectId: "pedidos-projetovale",
     storageBucket: "pedidos-projetovale.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcabcabcabcabc"
   };
   ```

   Copie esses 6 valores.

6. Abra o arquivo **`app.js`** (que veio junto com este guia) em qualquer
   editor de texto simples (Bloco de Notas, ou o próprio site do GitHub — veja
   a Parte 2) e, logo no topo, substitua o objeto `FIREBASE_CONFIG` pelos
   valores que você copiou:

   ```js
   const FIREBASE_CONFIG = {
     apiKey: "AIzaSy...........................",
     authDomain: "pedidos-projetovale.firebaseapp.com",
     projectId: "pedidos-projetovale",
     storageBucket: "pedidos-projetovale.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcabcabcabcabc"
   };
   ```

   Salve o arquivo.

   > **Isso já está feito:** o `app.js` que você recebeu já está com a
   > configuração do projeto `controle-pedidos` preenchida. Você só precisaria
   > repetir este passo se um dia criar um projeto Firebase novo.

### Regras de segurança

Ainda no console do Firebase:

- Vá em **Firestore Database → Regras** e substitua o conteúdo por:

  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /pedidos/{pedidoId} {
        allow read, write: if request.auth != null;
      }
    }
  }
  ```

- Vá em **Storage → Regras** e substitua o conteúdo por:

  ```
  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {
      match /pedidos/{allPaths=**} {
        allow read, write: if request.auth != null;
      }
    }
  }
  ```

Clique em **Publicar** nas duas telas. Isso garante que só quem abre o app
(e recebe um login anônimo automático) consegue ler ou gravar os pedidos —
ninguém de fora consegue acessar os dados sem o link e o app.

---

## Parte 2 — Publicar o app num link (GitHub Pages, grátis)

Não precisa de programador nem de terminal — tudo pelo navegador.

1. Crie uma conta gratuita em **github.com** (se ainda não tiver).
2. Clique em **"New repository"** (Novo repositório). Dê um nome, por
   exemplo `controle-pedidos`, marque como **Public** e clique em
   **Create repository**.
3. Na página do repositório, clique em **"Add file" → "Upload files"**.
4. Arraste os 5 arquivos que vieram com este guia para a página:
   - `index.html`
   - `app.js` (já com o `FIREBASE_CONFIG` preenchido)
   - `manifest.json`
   - `sw.js`
   - `icon-192.png`
   - `icon-512.png`
5. Clique em **"Commit changes"** para salvar.
6. Vá em **Settings → Pages** (menu lateral do repositório).
7. Em **"Branch"**, escolha `main` e a pasta `/ (root)`, depois clique em
   **Save**.
8. Aguarde 1 a 2 minutos. A própria página vai mostrar o link do app, algo
   como:

   `https://SEU-USUARIO.github.io/controle-pedidos/`

Esse é o link que Cristian, Pietro, Rodrigues, Ricardo, Gabriel, Davi e o ADM
vão abrir no celular.

### Instalar como app no celular

No navegador do celular (Chrome no Android, Safari no iPhone), abra o link e:

- **Android (Chrome):** toque nos três pontinhos → **"Adicionar à tela
  inicial" / "Instalar app"**.
- **iPhone (Safari):** toque no ícone de compartilhar (quadrado com seta) →
  **"Adicionar à Tela de Início"**.

O ícone do app (a caixa azul 📦) vai aparecer na tela do celular como
qualquer outro aplicativo, sem precisar da App Store ou Play Store.

---

## Como usar o app

1. Cada pessoa abre o app e toca no próprio nome (Cristian, Pietro,
   Rodrigues, Ricardo, Gabriel, Davi ou ADM) — isso fica salvo no celular
   dela, não precisa escolher de novo depois.
2. Na tela inicial, digita o **número do pedido** e toca em **Abrir** — se o
   pedido já existe, abre ele; se não existe, cria na hora.
3. Dentro do pedido existem 3 etapas: **Separação no estoque**,
   **Carregamento** e **Descarregamento na entrega**. Em cada uma, a pessoa
   toca em **"📷 Tirar foto"**, a câmera do celular abre, e a foto fica
   registrada com o nome de quem tirou e o dia/hora exatos.
4. Se uma foto ficou errada, é só tocar no **✕** em cima da foto para
   removê-la e tirar outra em seguida.
5. Na tela inicial, todo mundo vê a lista de pedidos com bolinhas verdes
   mostrando quais das 3 etapas já foram concluídas.
6. Quem entra como **ADM** tem um botão extra, **"Painel ADM"**, com a lista
   completa de pedidos, todas as fotos de cada um, e a opção de excluir um
   pedido inteiro se for criado por engano.

---

## Adicionar ou remover usuários

Para mudar a lista de nomes (por exemplo, contratar alguém novo), abra o
`app.js` no GitHub (clique no arquivo → ícone de lápis ✎ para editar) e
altere esta linha, perto do topo:

```js
const USERS = ["Cristian", "Pietro", "Rodrigues", "Ricardo", "Gabriel", "Davi"];
```

Adicione ou remova nomes entre aspas, separados por vírgula, e clique em
**"Commit changes"**. Em alguns segundos o app publicado já reflete a
mudança.

---

## Dúvidas comuns

- **"Configuração pendente" aparece na tela:** o `FIREBASE_CONFIG` no
  `app.js` ainda está com os valores de exemplo — volte à Parte 1, passo 6.
- **As fotos não aparecem em outro celular:** confira sua internet e se as
  regras de segurança (Parte 1) foram publicadas nas duas telas (Firestore e
  Storage).
- **Quer usar sem custo algum:** o plano gratuito do Firebase (Spark) cobre
  bem o uso de um pequeno depósito (milhares de fotos e pedidos por mês); só
  vale de olho se o uso crescer muito.
