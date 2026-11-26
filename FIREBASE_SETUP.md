# Configurar login e sincronização do Kartou!

O login e a sincronização entre dispositivos usam Firebase Authentication e Cloud Firestore.

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) e registre um aplicativo Web.
2. Em **Authentication > Sign-in method**, ative **E-mail/senha** e **Google**.
3. Em **Firestore Database**, crie o banco e publique as regras do arquivo `firestore.rules`.
4. Copie `apiKey`, `authDomain`, `projectId` e `appId` da configuração do app Web para `firebase-config.js`.
5. Em **Authentication > Settings > Authorized domains**, autorize `localhost` e o domínio onde o Kartou! será publicado.
6. Sirva o diretório por HTTP (por exemplo, com Live Server) e abra o endereço local. Os módulos oficiais do Firebase são carregados pelo CDN.

Cada usuário terá os dados no caminho `users/{uid}/kartou/data`, protegido pelas regras para que apenas a própria conta leia e grave seus eventos, pilotos, karts e históricos.
